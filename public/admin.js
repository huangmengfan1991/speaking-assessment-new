const pinInput = document.querySelector("#pinInput");
const loadBtn = document.querySelector("#loadBtn");
const exportBtn = document.querySelector("#exportBtn");
const submissionsEl = document.querySelector("#submissions");
const adminStatus = document.querySelector("#adminStatus");
const configStatus = document.querySelector("#configStatus");

let questions = [];
let submissions = [];
let currentPin = "";
let refreshTimer = null;
let aiConfigured = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setAdminStatus(message, isError = false) {
  adminStatus.textContent = message;
  adminStatus.classList.toggle("danger", isError);
}

function setConfigStatus(message, isError = false) {
  configStatus.textContent = message;
  configStatus.classList.toggle("danger", isError);
}

function getTotalScore(card) {
  const selects = [...card.querySelectorAll("select[data-question-id]")];
  const values = selects.map((select) => Number(select.value || 0)).filter(Boolean);
  if (!values.length) return "";
  return values.reduce((sum, value) => sum + value, 0);
}

function renderScoreOptions(value) {
  return [1, 2, 3, 4, 5]
    .map((score) => `<option value="${score}" ${String(value) === String(score) ? "selected" : ""}>${score}</option>`)
    .join("");
}

function renderList(items) {
  if (!items?.length) return "";
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderAiFeedback(feedback) {
  if (!aiConfigured) return "";

  if (!feedback) {
    return `<div class="ai-box muted-box">AI feedback is waiting to be generated.</div>`;
  }

  return `
    <div class="ai-box">
      <div class="ai-status">${escapeHtml(feedback.status || "pending")}</div>
      <p><strong>Transcript:</strong> ${escapeHtml(feedback.transcript || "No transcript yet.")}</p>
      <p><strong>AI feedback:</strong> ${escapeHtml(feedback.summary || "No feedback yet.")}</p>
      ${renderList(feedback.strengths)}
      ${renderList(feedback.improvements)}
      ${feedback.nextPractice ? `<p><strong>Next practice:</strong> ${escapeHtml(feedback.nextPractice)}</p>` : ""}
    </div>
  `;
}

function renderSubmissions() {
  if (!submissions.length) {
    submissionsEl.innerHTML = `<section class="panel student-panel">No submissions yet.</section>`;
    return;
  }

  submissionsEl.innerHTML = submissions
    .map(
      (submission) => `
        <article class="submission-card" data-submission-id="${submission.id}">
          <div class="submission-head">
            <div>
              <h2>${escapeHtml(submission.studentName)}</h2>
              <div class="meta">${escapeHtml(submission.grade)}${submission.className ? ` · ${escapeHtml(submission.className)}` : ""} · ${new Date(submission.submittedAt).toLocaleString()}</div>
            </div>
            <div class="score-total">Total: <span data-total>${escapeHtml(submission.totalScore || "-")}</span> / 25</div>
          </div>

          ${questions
            .map((question, index) => {
              const answer = submission.answers.find((item) => item.questionId === question.id);
              const audioSrc = answer
                ? `/api/admin/audio/${encodeURIComponent(answer.filename)}?pin=${encodeURIComponent(currentPin)}`
                : "";
              return `
                <div class="answer-review">
                  <div>
                    <h3>${index + 1}. ${escapeHtml(question.title)}</h3>
                    <p class="meta">${escapeHtml(question.prompt)}</p>
                    <audio controls src="${audioSrc}"></audio>
                  </div>
                  <label>
                    Score
                    <select data-question-id="${question.id}">
                      <option value="">Not scored</option>
                      ${renderScoreOptions(submission.ratings?.[question.id])}
                    </select>
                  </label>
                  ${renderAiFeedback(submission.aiFeedback?.[question.id])}
                </div>
              `;
            })
            .join("")}

          <div class="review-actions">
            <span class="meta" data-save-status></span>
            ${aiConfigured ? `<button type="button" data-ai-feedback>Regenerate AI feedback</button>` : ""}
            <button type="button" class="primary" data-save>Save review</button>
          </div>
        </article>
      `,
    )
    .join("");
}

async function loadSubmissions() {
  setAdminStatus("Loading submissions...");
  currentPin = pinInput.value;
  try {
    const [configResponse, submissionsResponse] = await Promise.all([
      fetch("/api/admin/config", { headers: { "x-admin-pin": currentPin } }),
      fetch("/api/admin/submissions", { headers: { "x-admin-pin": currentPin } }),
    ]);
    const config = await configResponse.json();
    const result = await submissionsResponse.json();
    if (!configResponse.ok) throw new Error(config.error || "Could not load server config.");
    if (!submissionsResponse.ok) throw new Error(result.error || "Could not load submissions.");
    submissions = result.submissions;
    questions = result.questions;
    aiConfigured = config.aiConfigured;
    exportBtn.disabled = false;
    renderSubmissions();
    setConfigStatus(
      config.aiConfigured
        ? `AI feedback is enabled (${config.transcribeModel} + ${config.evalModel}).`
        : "AI feedback is off. Teacher scoring and audio playback are ready.",
      false,
    );
    setAdminStatus(`Loaded ${submissions.length} submission(s).`);
  } catch (error) {
    setAdminStatus(error.message, true);
  }
}

function scheduleRefresh(message = "Refreshing AI feedback...") {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    setAdminStatus(message);
    await loadSubmissions();
  }, 2500);
}

loadBtn.addEventListener("click", loadSubmissions);

exportBtn.addEventListener("click", () => {
  fetch("/api/admin/export.csv", { headers: { "x-admin-pin": pinInput.value } })
    .then((response) => {
      if (!response.ok) throw new Error("Export failed.");
      return response.blob();
    })
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "speaking-assessment.csv";
      link.click();
      URL.revokeObjectURL(url);
    })
    .catch((error) => setAdminStatus(error.message, true));
});

submissionsEl.addEventListener("change", (event) => {
  const card = event.target.closest(".submission-card");
  if (!card) return;
  card.querySelector("[data-total]").textContent = getTotalScore(card) || "-";
});

submissionsEl.addEventListener("click", async (event) => {
  const saveButton = event.target.closest("[data-save]");
  if (!saveButton) return;
  const card = saveButton.closest(".submission-card");
  const id = card.dataset.submissionId;
  const saveStatus = card.querySelector("[data-save-status]");
  const ratings = {};

  card.querySelectorAll("select[data-question-id]").forEach((select) => {
    if (select.value) ratings[select.dataset.questionId] = select.value;
  });

  saveButton.disabled = true;
  saveStatus.textContent = "Saving...";

  try {
    const response = await fetch(`/api/admin/submissions/${id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-pin": pinInput.value,
      },
      body: JSON.stringify({ ratings, totalScore: getTotalScore(card) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Save failed.");
    saveStatus.textContent = "Saved.";
  } catch (error) {
    saveStatus.textContent = error.message;
    saveStatus.classList.add("danger");
  } finally {
    saveButton.disabled = false;
  }
});

submissionsEl.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-ai-feedback]");
  if (!button) return;
  const card = button.closest(".submission-card");
  const id = card.dataset.submissionId;
  const saveStatus = card.querySelector("[data-save-status]");

  button.disabled = true;
  saveStatus.textContent = "AI feedback requested. The page will refresh automatically.";

  try {
    const response = await fetch(`/api/admin/ai-feedback/${id}`, {
      method: "POST",
      headers: { "x-admin-pin": pinInput.value },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "AI feedback request failed.");
    if (result.status === "not_configured") {
      saveStatus.textContent = "AI feedback is not enabled. Set OPENAI_API_KEY and restart.";
    } else {
      scheduleRefresh();
    }
  } catch (error) {
    saveStatus.textContent = error.message;
    saveStatus.classList.add("danger");
  } finally {
    button.disabled = false;
  }
});
