# Vellum & Vale

A tactile, distraction-aware novel writing studio with secure writer accounts, cloud-ready manuscript storage, collaborators, private reader links, and reader comments.

## Run it

```powershell
npm.cmd start
```

Then open `http://127.0.0.1:4173`.

Create an account on the first screen. Drafts are saved automatically to the built-in SQLite database. Use **Share** to create a private reader link or invite another registered writer.

## Put it online

This repository includes a Dockerfile and a Render Blueprint. Push the folder to a private GitHub repository, create a Render Blueprint from `render.yaml`, and Render will provision the web service and persistent manuscript disk. Keep the persistent disk enabled: it contains the encrypted-password account database and manuscripts.
