const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const state = { user: null, project: null, scene: null, authMode: 'register' };
const api = async (url, options = {}) => {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
};
const initials = name => name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
const safeManuscript = html => {
  const template = document.createElement('template'); template.innerHTML = html;
  template.content.querySelectorAll('script,style,iframe,object,embed,form,input,button').forEach(node => node.remove());
  template.content.querySelectorAll('*').forEach(node => [...node.attributes].forEach(attribute => { if (attribute.name.startsWith('on') || /^(javascript|data):/i.test(attribute.value)) node.removeAttribute(attribute.name); }));
  return template.innerHTML;
};

const showStudio = async () => {
  const data = await api('/api/bootstrap');
  state.user = data.user; state.project = data.project; state.scene = data.scenes[0];
  $('#authScreen').classList.add('hidden'); $('#readerScreen').classList.add('hidden'); $('#appShell').classList.remove('hidden');
  $('#profileBtn').textContent = initials(data.user.name); $('.project-title').childNodes[0].textContent = `${data.project.title} `;
  if (state.scene) { $('#sceneTitle').value = state.scene.title; $('#crumbScene').textContent = state.scene.title; $('#editor').innerHTML = state.scene.content; }
  $('#memberList').innerHTML = ''; data.members.forEach(item => { const member=document.createElement('span'); member.textContent=`${item.name} · ${item.role}`; $('#memberList').appendChild(member); });
  updateWordCount(false);
};

const renderComments = comments => {
  $('#comments').innerHTML = '';
  comments.forEach(comment => {
    const item = document.createElement('article'); item.className = 'comment';
    const strong = document.createElement('strong'); strong.textContent = comment.name;
    const time = document.createElement('time'); time.textContent = new Date(comment.created_at).toLocaleDateString();
    const copy = document.createElement('p'); copy.textContent = comment.body;
    item.append(strong, time, copy); $('#comments').appendChild(item);
  });
};

const showReader = async token => {
  try {
    const data = await api(`/api/read/${token}`); $('#authScreen').classList.add('hidden'); $('#appShell').classList.add('hidden'); $('#readerScreen').classList.remove('hidden');
    $('#readerProject').textContent = data.project_title; $('#readerTitle').textContent = data.title; $('#readerCopy').innerHTML = safeManuscript(data.content); renderComments(data.comments);
    if (!data.allow_comments) $('#commentForm').classList.add('hidden');
  } catch (error) { $('#authError').textContent = error.message; }
};

$('#authSwitch').addEventListener('click', () => {
  state.authMode = state.authMode === 'register' ? 'login' : 'register'; const login = state.authMode === 'login';
  $('.name-field').classList.toggle('hidden', login); $('.name-field input').required = !login;
  $('.auth-submit').textContent = login ? 'Enter my writing studio' : 'Create my writing studio';
  $('#authSwitch').innerHTML = login ? 'New to Vellum & Vale? <strong>Create an account</strong>' : 'Already have an account? <strong>Sign in</strong>';
  $('#authError').textContent = '';
});

$('#authForm').addEventListener('submit', async event => {
  event.preventDefault(); const form = new FormData(event.currentTarget); const button = $('.auth-submit');
  button.disabled = true; button.textContent = state.authMode === 'login' ? 'Opening your studio…' : 'Building your studio…';
  try { await api(`/api/auth/${state.authMode}`, { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) }); await showStudio(); }
  catch (error) { $('#authError').textContent = error.message; button.textContent = state.authMode === 'login' ? 'Enter my writing studio' : 'Create my writing studio'; }
  finally { button.disabled = false; }
});

$('#commentForm').addEventListener('submit', async event => {
  event.preventDefault(); const token = location.pathname.split('/').pop(), form = new FormData(event.currentTarget);
  try { await api(`/api/read/${token}`, { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) }); event.currentTarget.reset(); const data = await api(`/api/read/${token}`); renderComments(data.comments); }
  catch (error) { alert(error.message); }
});

const toast = (message) => {
  const element = $('#toast');
  $('p', element).textContent = message;
  element.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => element.classList.remove('show'), 2200);
};

const switchView = (name) => {
  $$('.rail-btn[data-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.view === name));
  $$('.view').forEach(view => view.classList.remove('active'));
  $(`#${name}View`).classList.add('active');
};

$$('.rail-btn[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));

$$('.panel-tabs button').forEach(button => button.addEventListener('click', () => {
  $$('.panel-tabs button').forEach(btn => btn.classList.remove('active'));
  button.classList.add('active');
  $('#manuscriptList').classList.toggle('hidden', button.dataset.panel !== 'manuscript');
  $('#notesList').classList.toggle('hidden', button.dataset.panel !== 'notes');
}));

$$('.part-title').forEach(button => button.addEventListener('click', () => {
  const part = button.closest('.part');
  part.classList.toggle('open');
  const list = $('.chapter-list', part);
  if (list) list.classList.toggle('hidden');
  $('.chevron', button).textContent = part.classList.contains('open') ? '⌄' : '›';
}));

$$('.scene-row').forEach(button => button.addEventListener('click', () => {
  $$('.scene-row').forEach(row => row.classList.remove('active'));
  button.classList.add('active');
  const title = button.querySelector('span:nth-child(2)').textContent;
  $('#sceneTitle').value = title;
  $('#crumbScene').textContent = title;
  switchView('write');
  toast(`Opened “${title}”`);
}));

const updateWordCount = (save = true) => {
  const words = $('#editor').innerText.trim().split(/\s+/).filter(Boolean).length;
  $('#wordCount').textContent = `${words} words`;
  $('.save-state').innerHTML = '<i></i> Saving…';
  clearTimeout(window.saveTimer);
  window.saveTimer = setTimeout(() => {
    if (save && state.scene) api(`/api/scenes/${state.scene.id}`, { method:'PUT', body:JSON.stringify({ title:$('#sceneTitle').value, content:$('#editor').innerHTML }) })
      .then(() => { $('.save-state').innerHTML = '<i></i> Saved'; })
      .catch(() => { $('.save-state').textContent = 'Save failed'; });
    else $('.save-state').innerHTML = '<i></i> Saved';
  }, 700);
};

$('#editor').addEventListener('input', updateWordCount);
$('#sceneTitle').addEventListener('input', event => { $('#crumbScene').textContent = event.target.value; updateWordCount(); });

$('#themeBtn').addEventListener('click', () => document.body.classList.toggle('dark'));
$('#focusBtn').addEventListener('click', () => {
  document.body.classList.toggle('focus-mode');
  $('#focusBtn').innerHTML = document.body.classList.contains('focus-mode') ? '<span>×</span> Exit focus' : '<span>⌗</span> Focus';
});

$('#shareBtn').addEventListener('click', () => $('#modalBackdrop').classList.add('open'));
$('#modalClose').addEventListener('click', () => $('#modalBackdrop').classList.remove('open'));
$('#modalBackdrop').addEventListener('click', event => { if (event.target === event.currentTarget) event.currentTarget.classList.remove('open'); });
$('#copyLink').addEventListener('click', async () => {
  try {
    let value = $('#shareLink').value;
    if (!value.startsWith('http')) { const data = await api('/api/share', { method:'POST', body:JSON.stringify({ sceneId:state.scene.id, allowComments:$('.toggle-row input').checked }) }); value=data.url; $('#shareLink').value=value; }
    await navigator.clipboard.writeText(value); $('#copyLink').textContent = 'Copied'; toast('Private reading link copied');
  } catch (error) { toast(error.message); }
});

$('#inviteWriter').addEventListener('click', async () => {
  try { const data=await api('/api/collaborators',{method:'POST',body:JSON.stringify({projectId:state.project.id,email:$('#inviteEmail').value})}); const member=document.createElement('span'); member.textContent=`${data.member.name} · writer`; $('#memberList').appendChild(member); $('#inviteEmail').value=''; toast('Writer added to this manuscript'); }
  catch(error) { toast(error.message); }
});

$('#profileBtn').addEventListener('click', async () => { if(confirm(`Sign out of ${state.user.name}'s studio?`)){ await api('/api/auth/logout',{method:'POST'}); location.reload(); } });

$('#continuePrompt').addEventListener('click', () => {
  const p = document.createElement('p');
  p.textContent = '“The roads are honest,” the woman said. “It’s the map that has something to hide.”';
  $('#editor').appendChild(p);
  updateWordCount();
  p.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const range = document.createRange();
  range.selectNodeContents(p);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  toast('A spark, not a shortcut');
});

document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); $('#continuePrompt').click(); }
  if (event.key === 'Escape') { $('#modalBackdrop').classList.remove('open'); if (document.body.classList.contains('focus-mode')) $('#focusBtn').click(); }
});

const addChapter = () => {
  const chapter = document.createElement('article');
  chapter.className = 'chapter';
  const count = $$('.chapter').length + 1;
  chapter.innerHTML = `<button class="chapter-row"><span class="drag">⠿</span><span><strong>${String(count).padStart(2,'0')}</strong> Untitled chapter</span><em>0</em></button>`;
  $('.part.open .chapter-list').appendChild(chapter);
  chapter.scrollIntoView({ behavior:'smooth' });
  toast('New chapter added');
};
$('#newChapter').addEventListener('click', addChapter);
$('#addBtn').addEventListener('click', addChapter);
$('#addCard').addEventListener('click', () => toast('Blank scene added to Setup'));
$('#addEntry').addEventListener('click', () => toast('New story-bible entry created'));
$('#searchBtn').addEventListener('click', () => toast('Search is ready — press ⌘ K anytime'));
$('#goalBtn').addEventListener('click', () => toast('258 words to today’s goal'));
$$('.scene-details button').forEach(btn => btn.addEventListener('click', () => toast(`${btn.querySelector('span').textContent} selector opened`)));

setInterval(() => {
  const save = $('.save-state');
  if (save && save.textContent.trim() === 'Saved') save.title = `Last saved ${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
}, 30000);

const readerToken = location.pathname.match(/^\/read\/([a-f0-9]+)$/)?.[1];
if (readerToken) showReader(readerToken);
else showStudio().catch(() => { $('#authScreen').classList.remove('hidden'); });
