const questionList = document.querySelector("#questionList");
const submitBtn = document.querySelector("#submitBtn");
const progressText = document.querySelector("#progressText");
const statusText = document.querySelector("#statusText");
const studentNameInput = document.querySelector("#studentName");
const gradeInput = document.querySelector("#grade");
const classNameInput = document.querySelector("#className");

let questions = [];
let activeRecorder = null;
let activeTimer = null;
let activeStartedAt = 0;
const recordings = new Map();

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

function updateProgress() {
  progressText.textContent = `${recordings.size} / ${questions.length} recorded`;
  submitBtn.disabled = recordings.size !== questions.length;
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("danger", isError);
}

function renderQuestions() {
  questionList.innerHTML = questions
    .map(
      (question, index) => `
        <article class="question-card" data-question-id="${question.id}">
          <div class="question-head">
            <div>
              <div class="question-number">Question ${index + 1}</div>
              <h2>${question.title}</h2>
            </div>
            <span class="hint">Suggested: ${question.recommendedSeconds}s</span>
          </div>
          <p class="prompt">${question.prompt}</p>
          <div class="answer-row">
            <button type="button" data-action="record">Start recording</button>
            <span class="timer">0:00</span>
            <audio controls hidden></audio>
          </div>
        </article>
      `,
    )
    .join("");
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function startRecording(card, button) {
  if (activeRecorder) {
    setStatus("Please stop the current recording first.", true);
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    activeRecorder = new MediaRecorder(stream);
    activeStartedAt = Date.now();
    const timer = card.querySelector(".timer");

    activeRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });

    activeRecorder.addEventListener("stop", async () => {
      clearInterval(activeTimer);
      const durationSeconds = Math.max(1, Math.round((Date.now() - activeStartedAt) / 1000));
      const blob = new Blob(chunks, { type: activeRecorder.mimeType || "audio/webm" });
      const audioData = await blobToDataUrl(blob);
      const questionId = card.dataset.questionId;
      const audio = card.querySelector("audio");

      recordings.set(questionId, { questionId, audioData, durationSeconds });
      audio.src = URL.createObjectURL(blob);
      audio.hidden = false;
      button.textContent = "Record again";
      button.dataset.action = "record";
      stream.getTracks().forEach((track) => track.stop());
      activeRecorder = null;
      setStatus("Recording saved. You can re-record any answer before submitting.");
      updateProgress();
    });

    activeRecorder.start();
    button.textContent = "Stop recording";
    button.dataset.action = "stop";
    timer.textContent = "0:00";
    activeTimer = setInterval(() => {
      timer.textContent = formatTime(Math.round((Date.now() - activeStartedAt) / 1000));
    }, 500);
    setStatus("Recording now. Speak clearly, then stop when finished.");
  } catch (error) {
    setStatus(`Microphone error: ${error.message}`, true);
  }
}

function stopRecording() {
  if (activeRecorder && activeRecorder.state !== "inactive") {
    activeRecorder.stop();
  }
}

questionList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const card = button.closest(".question-card");
  if (button.dataset.action === "stop") {
    stopRecording();
    return;
  }
  startRecording(card, button);
});

submitBtn.addEventListener("click", async () => {
  const payload = {
    studentName: studentNameInput.value,
    grade: gradeInput.value,
    className: classNameInput.value,
    answers: questions.map((question) => recordings.get(question.id)),
  };

  submitBtn.disabled = true;
  setStatus("Submitting recordings...");

  try {
    const response = await fetch("/api/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Submission failed.");
    setStatus(`Submitted successfully. Submission ID: ${result.submissionId}`);
    questionList.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });
  } catch (error) {
    setStatus(error.message, true);
    updateProgress();
  }
});

async function init() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setStatus("This browser does not support recording. Please use Chrome, Edge, or Safari.", true);
    return;
  }

  const response = await fetch("/api/questions");
  const result = await response.json();
  questions = result.questions;
  renderQuestions();
  updateProgress();
}

init();
