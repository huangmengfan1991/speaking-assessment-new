# English Speaking Assessment

A small no-dependency Node.js app for collecting student speaking recordings and reviewing them in a teacher admin page.

## Run

```bash
npm start
```

Student link:

```text
http://localhost:4173
```

Teacher admin:

```text
http://localhost:4173/admin.html
```

Local default admin PIN:

```text
123456
```

For deployment, always set your own admin PIN:

```bash
ADMIN_PIN=your-pin node server.js
```

## AI feedback

AI feedback is optional. The app works without any AI API key: students can submit recordings, teachers can play audio, score answers, and export CSV.

If you later want automatic AI feedback, set an OpenAI API key before starting the server:

```bash
OPENAI_API_KEY=your-api-key node server.js
```

Optional model settings:

```bash
OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe OPENAI_EVAL_MODEL=gpt-5-mini node server.js
```

AI feedback is generated in the background after a student submits. The teacher admin can also regenerate it for any submission.

If no API key is set, the teacher admin hides AI feedback controls.

## Deploy to Render

This app is ready for a Render Web Service.

1. Push this folder to a GitHub repository.
2. In Render, create a new Web Service from that repository.
3. Use:
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Set environment variables:
   - `ADMIN_PIN`: your teacher admin password
   - `OPENAI_API_KEY`: optional, only if you want AI feedback
   - `STORAGE_DIR`: `/var/data`
5. Add a persistent disk:
   - Mount path: `/var/data`
   - Size: start with `1 GB`

After deploy, Render gives you a public URL. Student page is `/`; teacher page is `/admin.html`.

## Data

- Audio files are stored in `uploads/`.
- Submission records and teacher reviews are stored in `data/submissions.json`.
- The teacher admin can export a CSV file.

For deployment, set `STORAGE_DIR=/var/data` and attach a persistent disk so uploaded audio and scores survive restarts.
