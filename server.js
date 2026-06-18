const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 4173);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'vellum.db'));
db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, word_goal INTEGER DEFAULT 75000, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS members (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL DEFAULT 'writer', PRIMARY KEY(project_id,user_id));
  CREATE TABLE IF NOT EXISTS scenes (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL, content TEXT NOT NULL, position INTEGER DEFAULT 1, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS share_links (token TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE, allow_comments INTEGER DEFAULT 1, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, share_token TEXT NOT NULL REFERENCES share_links(token) ON DELETE CASCADE, name TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

const starterContent = `<p>By dusk, the western gate had forgotten it was a gate.</p><p>Rain silvered the old ironwork and gathered in the carved letters above the arch—names of kings no one bothered to remember. Elian stood beneath them with the letter pressed inside his coat, feeling the paper’s sharp corners each time he breathed.</p><p>The guards did not look at him. That was the first wrong thing.</p><p>They watched the road instead, both men facing outward as if the danger lay in the country he had crossed, not the city behind them. Beyond the arch, Valenne rose in terraces of slate and smoke. A thousand windows caught the last of the light.</p><p>None of them matched the map.</p>`;
const json = (res, status, value, headers = {}) => { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', ...headers }); res.end(JSON.stringify(value)); };
const readBody = req => new Promise((resolve, reject) => { let raw=''; req.on('data', chunk => { raw += chunk; if(raw.length > 2_000_000) reject(new Error('Request too large')); }); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid request')); } }); });
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(item => { const [key,...value]=item.trim().split('='); return [key,decodeURIComponent(value.join('='))]; }));
const sessionUser = req => { const token=cookies(req).vv_session; if(!token) return null; return db.prepare(`SELECT u.id,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at > datetime('now')`).get(token) || null; };
const canEdit = (userId, projectId) => !!db.prepare(`SELECT 1 FROM projects p LEFT JOIN members m ON m.project_id=p.id AND m.user_id=? WHERE p.id=? AND (p.owner_id=? OR m.user_id=?)`).get(userId,projectId,userId,userId);
const clean = (value, max=10000) => String(value || '').trim().slice(0,max);
const hashPassword = (password,salt) => crypto.scryptSync(password,salt,64).toString('hex');
const setSession = (res,userId) => { const token=crypto.randomBytes(32).toString('hex'); const expires=new Date(Date.now()+30*864e5).toISOString(); db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(token,userId,expires); return `vv_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.NODE_ENV==='production'?'; Secure':''}`; };

function createStarterProject(userId) {
  const projectId=crypto.randomUUID(), sceneId=crypto.randomUUID();
  db.prepare('INSERT INTO projects(id,owner_id,title) VALUES(?,?,?)').run(projectId,userId,"The Cartographer’s Lie");
  db.prepare('INSERT INTO scenes(id,project_id,title,content) VALUES(?,?,?,?)').run(sceneId,projectId,'Through the western gate',starterContent);
  return projectId;
}

async function api(req,res,url) {
  try {
    if(req.method==='POST' && url.pathname==='/api/auth/register') {
      const body=await readBody(req), name=clean(body.name,80), email=clean(body.email,160).toLowerCase(), password=String(body.password||'');
      if(!name || !email.includes('@') || password.length<8) return json(res,400,{error:'Enter your name, a valid email, and an 8-character password.'});
      if(db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return json(res,409,{error:'An account with that email already exists.'});
      const id=crypto.randomUUID(), salt=crypto.randomBytes(16).toString('hex');
      db.prepare('INSERT INTO users(id,name,email,password_hash,salt) VALUES(?,?,?,?,?)').run(id,name,email,hashPassword(password,salt),salt); createStarterProject(id);
      return json(res,201,{user:{id,name,email}},{'Set-Cookie':setSession(res,id)});
    }
    if(req.method==='POST' && url.pathname==='/api/auth/login') {
      const body=await readBody(req), email=clean(body.email,160).toLowerCase(), password=String(body.password||''), user=db.prepare('SELECT * FROM users WHERE email=?').get(email);
      if(!user) return json(res,401,{error:'Email or password is incorrect.'});
      const actual=Buffer.from(hashPassword(password,user.salt),'hex'), expected=Buffer.from(user.password_hash,'hex');
      if(actual.length!==expected.length || !crypto.timingSafeEqual(actual,expected)) return json(res,401,{error:'Email or password is incorrect.'});
      return json(res,200,{user:{id:user.id,name:user.name,email:user.email}},{'Set-Cookie':setSession(res,user.id)});
    }
    if(req.method==='POST' && url.pathname==='/api/auth/logout') return json(res,200,{ok:true},{'Set-Cookie':'vv_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});

    const readMatch=url.pathname.match(/^\/api\/read\/([a-f0-9]+)$/);
    if(readMatch && req.method==='GET') {
      const shared=db.prepare(`SELECT sl.token,sl.allow_comments,p.title project_title,s.title,s.content FROM share_links sl JOIN projects p ON p.id=sl.project_id JOIN scenes s ON s.id=sl.scene_id WHERE sl.token=?`).get(readMatch[1]);
      if(!shared) return json(res,404,{error:'This reading link is no longer available.'});
      const comments=db.prepare('SELECT id,name,body,created_at FROM comments WHERE share_token=? ORDER BY created_at').all(readMatch[1]); return json(res,200,{...shared,comments});
    }
    if(readMatch && req.method==='POST') {
      const shared=db.prepare('SELECT allow_comments FROM share_links WHERE token=?').get(readMatch[1]); if(!shared || !shared.allow_comments) return json(res,403,{error:'Comments are closed.'});
      const body=await readBody(req), name=clean(body.name,80), text=clean(body.body,2000); if(!name||!text) return json(res,400,{error:'Name and comment are required.'});
      db.prepare('INSERT INTO comments(id,share_token,name,body) VALUES(?,?,?,?)').run(crypto.randomUUID(),readMatch[1],name,text); return json(res,201,{ok:true});
    }

    const user=sessionUser(req); if(!user) return json(res,401,{error:'Sign in required.'});
    if(req.method==='GET' && url.pathname==='/api/bootstrap') {
      let project=db.prepare(`SELECT DISTINCT p.* FROM projects p LEFT JOIN members m ON m.project_id=p.id WHERE p.owner_id=? OR m.user_id=? ORDER BY p.created_at LIMIT 1`).get(user.id,user.id);
      if(!project) { createStarterProject(user.id); project=db.prepare('SELECT * FROM projects WHERE owner_id=? ORDER BY created_at LIMIT 1').get(user.id); }
      const scenes=db.prepare('SELECT * FROM scenes WHERE project_id=? ORDER BY position').all(project.id); const members=db.prepare(`SELECT u.name,u.email,m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.project_id=?`).all(project.id);
      return json(res,200,{user,project,scenes,members});
    }
    const sceneMatch=url.pathname.match(/^\/api\/scenes\/([a-f0-9-]+)$/);
    if(sceneMatch && req.method==='PUT') {
      const scene=db.prepare('SELECT * FROM scenes WHERE id=?').get(sceneMatch[1]); if(!scene || !canEdit(user.id,scene.project_id)) return json(res,403,{error:'You cannot edit this scene.'});
      const body=await readBody(req), title=clean(body.title,200), content=String(body.content||'').slice(0,1_500_000); db.prepare(`UPDATE scenes SET title=?,content=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(title,content,scene.id); return json(res,200,{ok:true});
    }
    if(req.method==='POST' && url.pathname==='/api/share') {
      const body=await readBody(req), scene=db.prepare('SELECT * FROM scenes WHERE id=?').get(body.sceneId); if(!scene || !canEdit(user.id,scene.project_id)) return json(res,403,{error:'You cannot share this scene.'});
      const token=crypto.randomBytes(12).toString('hex'); db.prepare('INSERT INTO share_links(token,project_id,scene_id,allow_comments,created_by) VALUES(?,?,?,?,?)').run(token,scene.project_id,scene.id,body.allowComments===false?0:1,user.id); return json(res,201,{url:`${url.origin}/read/${token}`});
    }
    if(req.method==='POST' && url.pathname==='/api/collaborators') {
      const body=await readBody(req), email=clean(body.email,160).toLowerCase(), project=db.prepare('SELECT * FROM projects WHERE id=? AND owner_id=?').get(body.projectId,user.id); if(!project) return json(res,403,{error:'Only the owner can invite writers.'});
      const invited=db.prepare('SELECT id,name,email FROM users WHERE email=?').get(email); if(!invited) return json(res,404,{error:'That writer must create an account first.'}); if(invited.id===user.id) return json(res,400,{error:'You already own this manuscript.'});
      db.prepare(`INSERT INTO members(project_id,user_id,role) VALUES(?,?,'writer') ON CONFLICT(project_id,user_id) DO NOTHING`).run(project.id,invited.id); return json(res,201,{member:invited});
    }
    json(res,404,{error:'Not found'});
  } catch(error) { console.error(error); json(res,500,{error:'Something went wrong. Please try again.'}); }
}

const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png'};
http.createServer((req,res) => {
  const url=new URL(req.url,`http://${req.headers.host || `127.0.0.1:${PORT}`}`);
  if(url.pathname.startsWith('/api/')) return api(req,res,url);
  const requested=url.pathname==='/' || url.pathname.startsWith('/read/') ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const file=path.resolve(__dirname,requested); if(!file.startsWith(path.resolve(__dirname)) || file.includes(`${path.sep}data${path.sep}`)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file,(error,contents) => { if(error){res.writeHead(404);res.end('Not found');return;} res.writeHead(200,{'Content-Type':`${types[path.extname(file)]||'text/plain'}; charset=utf-8`,'X-Content-Type-Options':'nosniff'});res.end(contents); });
}).listen(PORT,'0.0.0.0',()=>console.log(`Vellum & Vale is running on http://localhost:${PORT}`));
