const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 4173;
const ADMIN_PIN = process.env.ADMIN_PIN || "123456";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
const EVAL_MODEL = process.env.OPENAI_EVAL_MODEL || "gpt-5-mini";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const STORAGE_DIR = process.env.STORAGE_DIR || ROOT;
const DATA_DIR = path.join(STORAGE_DIR, "data");
const UPLOAD_DIR = path.join(STORAGE_DIR, "uploads");
const DB_FILE = path.join(DATA_DIR, "submissions.json");

const QUESTIONS = [
  {
    id: "q1",
    title: "Self Introduction",
    prompt: "Tell me your name, grade, favourite subject and one hobby.",
    recommendedSeconds: 30,
  },
  {
    id: "q2",
    title: "Past Weekend",
    prompt:
      "Talk about one fun thing you did last weekend. Say where you went and who you were with.",
    recommendedSeconds: 45,
  },
  {
    id: "q3",
    title: "Preference",
    prompt:
      "Do you prefer playing outside or staying at home on holidays? Give two reasons.",
    recommendedSeconds: 60,
  },
  {
    id: "q4",
    title: "Problem Solving",
    prompt:
      "You have lots of homework and no time for your hobbies. What ways can you solve this problem?",
    recommendedSeconds: 90,
  },
  {
    id: "q5",
    title: "Opinion",
    prompt:
      "Do you think students should take many after-school classes? Explain both good and bad points.",
    recommendedSeconds: 90,
  },
];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webm": "audio/webm",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
};

function ensureStorage() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, "[]\n");
  }
}

function readSubmissions() {
  ensureStorage();
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeSubmissions(submissions) {
  fs.writeFileSync(DB_FILE, `${JSON.stringify(submissions, null, 2)}\n`);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 80 * 1024 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function requireAdmin(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pin = req.headers["x-admin-pin"] || url.searchParams.get("pin");
  if (pin !== ADMIN_PIN) {
    sendJson(res, 401, { error: "Admin PIN is incorrect." });
    return false;
  }
  return true;
}

function safeAudioExtension(mimeType) {
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return ".m4a";
  if (mimeType.includes("wav")) return ".wav";
  return ".webm";
}

function saveAudioFile(answer, submissionId) {
  const match = /^data:(.*?);base64,(.*)$/.exec(answer.audioData || "");
  if (!match) {
    throw new Error("Invalid audio data.");
  }

  const mimeType = match[1] || "audio/webm";
  const extension = safeAudioExtension(mimeType);
  const filename = `${submissionId}-${answer.questionId}${extension}`;
  const filePath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filePath, Buffer.from(match[2], "base64"));

  return {
    questionId: answer.questionId,
    filename,
    audioUrl: `/uploads/${filename}`,
    mimeType,
    durationSeconds: Number(answer.durationSeconds || 0),
    sizeBytes: fs.statSync(filePath).size,
  };
}

function sanitizeSubmission(payload) {
  const name = String(payload.studentName || "").trim();
  const grade = String(payload.grade || "").trim();
  const className = String(payload.className || "").trim();
  const answers = Array.isArray(payload.answers) ? payload.answers : [];

  if (!name) throw new Error("Student name is required.");
  if (!grade) throw new Error("Grade is required.");
  if (answers.length !== QUESTIONS.length) {
    throw new Error("Please record all five answers before submitting.");
  }

  const questionIds = new Set(QUESTIONS.map((question) => question.id));
  for (const answer of answers) {
    if (!questionIds.has(answer.questionId)) {
      throw new Error("Unknown question id.");
    }
    if (!answer.audioData) {
      throw new Error("Missing audio recording.");
    }
  }

  return { name, grade, className, answers };
}

function publicSubmission(submission) {
  return {
    ...submission,
    ratings: submission.ratings || {},
    teacherNotes: submission.teacherNotes || {},
    aiFeedback: submission.aiFeedback || {},
  };
}

function getCsvValue(value) {
  const stringValue = String(value ?? "");
  return `"${stringValue.replaceAll('"', '""')}"`;
}

function buildCsv(submissions) {
  const headers = [
    "submittedAt",
    "studentName",
    "grade",
    "className",
    "totalScore",
    ...QUESTIONS.flatMap((question) => [
      `${question.id}_audio`,
      `${question.id}_score`,
      `${question.id}_transcript`,
      `${question.id}_ai_feedback`,
    ]),
  ];
  const rows = submissions.map((submission) => {
    const values = [
      submission.submittedAt,
      submission.studentName,
      submission.grade,
      submission.className,
      submission.totalScore || "",
      ...QUESTIONS.flatMap((question) => {
        const answer = submission.answers.find((item) => item.questionId === question.id);
        return [
          answer ? answer.audioUrl : "",
          submission.ratings?.[question.id] || "",
          submission.aiFeedback?.[question.id]?.transcript || "",
          submission.aiFeedback?.[question.id]?.summary || "",
        ];
      }),
    ];
    return values.map(getCsvValue).join(",");
  });

  return [headers.map(getCsvValue).join(","), ...rows].join("\n");
}

function extractResponseText(responsePayload) {
  if (responsePayload.output_text) return responsePayload.output_text;
  const textParts = [];
  for (const output of responsePayload.output || []) {
    for (const content of output.content || []) {
      if (content.type === "output_text" && content.text) textParts.push(content.text);
      if (content.type === "text" && content.text) textParts.push(content.text);
    }
  }
  return textParts.join("\n").trim();
}

function normalizeAiFeedback(rawText, transcript) {
  try {
    const parsed = JSON.parse(rawText);
    return {
      status: "complete",
      transcript,
      summary: String(parsed.summary || "").trim(),
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 3) : [],
      improvements: Array.isArray(parsed.improvements) ? parsed.improvements.slice(0, 3) : [],
      nextPractice: String(parsed.nextPractice || "").trim(),
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return {
      status: "complete",
      transcript,
      summary: rawText.trim(),
      strengths: [],
      improvements: [],
      nextPractice: "",
      generatedAt: new Date().toISOString(),
    };
  }
}

async function transcribeAudio(answer) {
  const filePath = path.join(UPLOAD_DIR, answer.filename);
  const form = new FormData();
  const blob = new Blob([fs.readFileSync(filePath)], {
    type: answer.mimeType || "audio/webm",
  });
  form.append("file", blob, answer.filename);
  form.append("model", TRANSCRIBE_MODEL);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.message || "Audio transcription failed.");
  }
  return String(payload.text || "").trim();
}

async function evaluateTranscript(question, answer, transcript) {
  const prompt = `
You are an English speaking assessment assistant for young learners.

Question:
${question.prompt}

Student transcript:
${transcript || "(No clear transcript was detected.)"}

Audio duration: ${answer.durationSeconds || 0} seconds.

Give concise feedback for the teacher and student. Focus on task completion, vocabulary, grammar, organization, and likely fluency based on transcript and duration. Do not claim precise pronunciation scoring because you only have the transcript.

Return strict JSON only:
{
  "summary": "one short overall comment",
  "strengths": ["up to 2 short strengths"],
  "improvements": ["up to 2 concrete improvements"],
  "nextPractice": "one specific practice task"
}
`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EVAL_MODEL,
      input: prompt,
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.message || "AI feedback failed.");
  }
  return normalizeAiFeedback(extractResponseText(payload), transcript);
}

function updateAiFeedback(submissionId, questionId, feedback) {
  const submissions = readSubmissions();
  const index = submissions.findIndex((submission) => submission.id === submissionId);
  if (index === -1) return;
  submissions[index].aiFeedback = {
    ...(submissions[index].aiFeedback || {}),
    [questionId]: feedback,
  };
  writeSubmissions(submissions);
}

async function generateAiFeedbackForSubmission(submissionId) {
  const submissions = readSubmissions();
  const submission = submissions.find((item) => item.id === submissionId);
  if (!submission) return;

  if (!OPENAI_API_KEY) {
    for (const answer of submission.answers) {
      updateAiFeedback(submissionId, answer.questionId, {
        status: "not_configured",
        transcript: "",
        summary: "Set OPENAI_API_KEY and regenerate AI feedback.",
        strengths: [],
        improvements: [],
        nextPractice: "",
        generatedAt: new Date().toISOString(),
      });
    }
    return;
  }

  for (const answer of submission.answers) {
    const question = QUESTIONS.find((item) => item.id === answer.questionId);
    updateAiFeedback(submissionId, answer.questionId, {
      status: "processing",
      transcript: "",
      summary: "AI feedback is being generated.",
      strengths: [],
      improvements: [],
      nextPractice: "",
      generatedAt: new Date().toISOString(),
    });

    try {
      const transcript = await transcribeAudio(answer);
      const feedback = await evaluateTranscript(question, answer, transcript);
      updateAiFeedback(submissionId, answer.questionId, feedback);
    } catch (error) {
      updateAiFeedback(submissionId, answer.questionId, {
        status: "error",
        transcript: "",
        summary: error.message,
        strengths: [],
        improvements: [],
        nextPractice: "",
        generatedAt: new Date().toISOString(),
      });
    }
  }
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/questions") {
    sendJson(res, 200, { questions: QUESTIONS });
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin/config") {
    if (!requireAdmin(req, res)) return;
    sendJson(res, 200, {
      aiConfigured: Boolean(OPENAI_API_KEY),
      transcribeModel: TRANSCRIBE_MODEL,
      evalModel: EVAL_MODEL,
      storageDir: STORAGE_DIR,
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/submissions") {
    try {
      const payload = JSON.parse(await readBody(req));
      const clean = sanitizeSubmission(payload);
      const id = crypto.randomUUID();
      const answers = clean.answers.map((answer) => saveAudioFile(answer, id));
      const submissions = readSubmissions();
      const submission = {
        id,
        studentName: clean.name,
        grade: clean.grade,
        className: clean.className,
        submittedAt: new Date().toISOString(),
        answers,
        ratings: {},
        teacherNotes: {},
        aiFeedback: {},
        totalScore: "",
      };
      submissions.unshift(submission);
      writeSubmissions(submissions);
      generateAiFeedbackForSubmission(id).catch((error) => {
        console.error("AI feedback generation failed:", error);
      });
      sendJson(res, 201, { submissionId: id });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin/submissions") {
    if (!requireAdmin(req, res)) return;
    sendJson(res, 200, { submissions: readSubmissions().map(publicSubmission), questions: QUESTIONS });
    return;
  }

  if (req.method === "POST" && pathname.startsWith("/api/admin/submissions/")) {
    if (!requireAdmin(req, res)) return;
    const id = pathname.split("/").at(-1);
    try {
      const payload = JSON.parse(await readBody(req));
      const submissions = readSubmissions();
      const index = submissions.findIndex((submission) => submission.id === id);
      if (index === -1) {
        sendJson(res, 404, { error: "Submission not found." });
        return;
      }
      submissions[index] = {
        ...submissions[index],
        ratings: payload.ratings || {},
        teacherNotes: {},
        totalScore: payload.totalScore || "",
        reviewedAt: new Date().toISOString(),
      };
      writeSubmissions(submissions);
      sendJson(res, 200, { submission: publicSubmission(submissions[index]) });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname.startsWith("/api/admin/ai-feedback/")) {
    if (!requireAdmin(req, res)) return;
    const id = pathname.split("/").at(-1);
    const submissions = readSubmissions();
    if (!submissions.some((submission) => submission.id === id)) {
      sendJson(res, 404, { error: "Submission not found." });
      return;
    }
    if (!OPENAI_API_KEY) {
      await generateAiFeedbackForSubmission(id);
      sendJson(res, 200, { status: "not_configured" });
      return;
    }
    generateAiFeedbackForSubmission(id).catch((error) => {
      console.error("AI feedback regeneration failed:", error);
    });
    sendJson(res, 202, { status: "processing" });
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin/export.csv") {
    if (!requireAdmin(req, res)) return;
    const csv = buildCsv(readSubmissions());
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"speaking-assessment.csv\"",
    });
    res.end(csv);
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/api/admin/audio/")) {
    if (!requireAdmin(req, res)) return;
    const filename = path.basename(decodeURIComponent(pathname.split("/").at(-1)));
    const filePath = path.join(UPLOAD_DIR, filename);
    if (!filePath.startsWith(UPLOAD_DIR) || !fs.existsSync(filePath)) {
      sendJson(res, 404, { error: "Audio file not found." });
      return;
    }
    const extension = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[extension] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  sendJson(res, 404, { error: "Not found." });
}

function serveStatic(req, res, pathname) {
  if (pathname.startsWith("/uploads/")) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const requestPath = pathname === "/" ? "/index.html" : pathname;
  const baseDir = PUBLIC_DIR;
  const filePath = path.normalize(path.join(baseDir, requestPath));

  if (!filePath.startsWith(baseDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const extension = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[extension] || "application/octet-stream" });
    res.end(data);
  });
}

ensureStorage();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url.pathname);
    return;
  }
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`Speaking assessment app running at http://localhost:${PORT}`);
  console.log(`Teacher admin: http://localhost:${PORT}/admin.html`);
  console.log(`Default admin PIN: ${ADMIN_PIN}`);
  console.log(`Storage directory: ${STORAGE_DIR}`);
  console.log(`AI feedback configured: ${Boolean(OPENAI_API_KEY)}`);
});
