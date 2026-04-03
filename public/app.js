const DEMO_STORAGE_KEY = "speakbetter_demo_sessions_v1";

const state = {
  userId: "user_demo",
  topic: null,
  sessionId: null,
  modeType: "logic",
  durationType: "1min",
  mediaRecorder: null,
  mediaStream: null,
  audioChunks: [],
  audioBlob: null,
  timer: null,
  remainingSeconds: 60,
  isRecording: false
};

const el = {
  navButtons: Array.from(document.querySelectorAll(".nav-btn")),
  tabs: Array.from(document.querySelectorAll(".tab")),
  modeSelect: document.getElementById("modeSelect"),
  durationSelect: document.getElementById("durationSelect"),
  difficultySelect: document.getElementById("difficultySelect"),
  targetSkillSelect: document.getElementById("targetSkillSelect"),
  generateTopicBtn: document.getElementById("generateTopicBtn"),
  startSessionBtn: document.getElementById("startSessionBtn"),
  topicCard: document.getElementById("topicCard"),
  topicTitle: document.getElementById("topicTitle"),
  topicContent: document.getElementById("topicContent"),
  topicMeta: document.getElementById("topicMeta"),
  trainingTopicText: document.getElementById("trainingTopicText"),
  timerValue: document.getElementById("timerValue"),
  recordStatus: document.getElementById("recordStatus"),
  recordBtn: document.getElementById("recordBtn"),
  stopBtn: document.getElementById("stopBtn"),
  submitBtn: document.getElementById("submitBtn"),
  trainingMessage: document.getElementById("trainingMessage"),
  manualTranscript: document.getElementById("manualTranscript"),
  overallScore: document.getElementById("overallScore"),
  resultSummary: document.getElementById("resultSummary"),
  dimensionScores: document.getElementById("dimensionScores"),
  issueTags: document.getElementById("issueTags"),
  detectedIssues: document.getElementById("detectedIssues"),
  suggestions: document.getElementById("suggestions"),
  frameworkName: document.getElementById("frameworkName"),
  frameworkOutline: document.getElementById("frameworkOutline"),
  rewriteConcise: document.getElementById("rewriteConcise"),
  rewriteLogic: document.getElementById("rewriteLogic"),
  rewriteEq: document.getElementById("rewriteEq"),
  modelAnswer: document.getElementById("modelAnswer"),
  retryBtn: document.getElementById("retryBtn"),
  goHistoryBtn: document.getElementById("goHistoryBtn"),
  historyList: document.getElementById("historyList"),
  refreshHistoryBtn: document.getElementById("refreshHistoryBtn")
};

init();

function init() {
  bindEvents();
  renderTimer();
  loadHistory();
}

function bindEvents() {
  el.navButtons.forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  el.generateTopicBtn.addEventListener("click", generateTopic);
  el.startSessionBtn.addEventListener("click", createSessionAndEnterTraining);
  el.recordBtn.addEventListener("click", startRecording);
  el.stopBtn.addEventListener("click", stopRecording);
  el.submitBtn.addEventListener("click", submitForEvaluation);
  el.retryBtn.addEventListener("click", () => {
    resetTrainingState();
    switchTab("homeTab");
  });
  el.goHistoryBtn.addEventListener("click", () => {
    loadHistory();
    switchTab("historyTab");
  });
  el.refreshHistoryBtn.addEventListener("click", loadHistory);

  el.historyList.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches("button[data-session-id]")) {
      return;
    }

    const sessionId = target.dataset.sessionId;
    if (!sessionId) {
      return;
    }

    try {
      const data = await apiGet(`/api/session/${sessionId}/result`);
      if (!data.report) {
        alert("该记录尚未完成评估。");
        return;
      }
      renderResult(data.report);
      switchTab("resultTab");
    } catch (error) {
      alert(error.message || "加载结果失败");
    }
  });
}

function switchTab(tabId) {
  el.tabs.forEach((tab) => tab.classList.toggle("active", tab.id === tabId));
  el.navButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tabId));
}

async function generateTopic() {
  const payload = {
    modeType: el.modeSelect.value,
    durationType: el.durationSelect.value,
    difficulty: el.difficultySelect.value,
    targetSkill: el.targetSkillSelect.value,
    weaknessTags: []
  };

  state.modeType = payload.modeType;
  state.durationType = payload.durationType;
  el.generateTopicBtn.disabled = true;
  el.generateTopicBtn.textContent = "生成中...";

  try {
    const data = await apiPost("/api/topic/generate", payload);
    state.topic = data.topic;
    renderTopicCard(data.topic);
    el.startSessionBtn.disabled = false;
  } catch (error) {
    alert(error.message || "题目生成失败");
  } finally {
    el.generateTopicBtn.disabled = false;
    el.generateTopicBtn.textContent = "生成题目";
  }
}

function renderTopicCard(topic) {
  el.topicTitle.textContent = topic.title;
  el.topicContent.textContent = topic.content;
  el.topicMeta.innerHTML = "";

  [
    typeLabel(topic.topic_type),
    difficultyLabel(topic.difficulty),
    topic.recommended_duration,
    topic.suggested_framework
  ].forEach((meta) => {
    const chip = document.createElement("span");
    chip.textContent = meta;
    el.topicMeta.appendChild(chip);
  });

  el.topicCard.classList.remove("hidden");
}

async function createSessionAndEnterTraining() {
  if (!state.topic) {
    alert("请先生成题目");
    return;
  }

  try {
    const data = await apiPost("/api/session/create", {
      userId: state.userId,
      modeType: state.modeType,
      durationType: state.durationType,
      topic: state.topic
    });

    state.sessionId = data.session.id;
    state.audioBlob = null;
    state.audioChunks = [];
    state.remainingSeconds = state.durationType === "3min" ? 180 : 60;
    el.trainingTopicText.textContent = state.topic.content;
    el.manualTranscript.value = "";
    el.recordStatus.textContent = "待开始";
    el.recordBtn.disabled = false;
    el.stopBtn.disabled = true;
    el.submitBtn.disabled = false;
    setTrainingMessage("会话已创建，点击“开始录音”进入训练。");
    renderTimer();
    switchTab("trainingTab");
  } catch (error) {
    alert(error.message || "创建训练会话失败");
  }
}

async function startRecording() {
  if (!state.sessionId) {
    setTrainingMessage("请先从首页生成题目并开始训练。", true);
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setTrainingMessage("当前浏览器不支持录音，请直接在下方输入回答文本。", true);
    el.submitBtn.disabled = false;
    return;
  }

  try {
    if (!state.mediaStream) {
      state.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }

    state.audioChunks = [];
    state.audioBlob = null;
    state.remainingSeconds = state.durationType === "3min" ? 180 : 60;
    renderTimer();

    const options = MediaRecorder.isTypeSupported("audio/webm") ? { mimeType: "audio/webm" } : undefined;
    const recorder = new MediaRecorder(state.mediaStream, options);

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        state.audioChunks.push(event.data);
      }
    };

    recorder.onstop = () => {
      state.audioBlob = new Blob(state.audioChunks, { type: recorder.mimeType || "audio/webm" });
      state.isRecording = false;
      el.recordStatus.textContent = "录音已完成";
      el.recordBtn.disabled = false;
      el.stopBtn.disabled = true;
      el.submitBtn.disabled = false;
      clearTimer();
      setTrainingMessage("录音完成，可以直接提交评估，也可以补充手动转写。");
    };

    recorder.start(250);
    state.mediaRecorder = recorder;
    state.isRecording = true;
    el.recordBtn.disabled = true;
    el.stopBtn.disabled = false;
    el.submitBtn.disabled = true;
    el.recordStatus.textContent = "录音中";
    setTrainingMessage("正在录音，请按“结论 -> 分点 -> 总结”的结构回答。");
    startTimerCountdown();
  } catch (error) {
    setTrainingMessage("麦克风不可用，请直接在下方输入回答文本。", true);
  }
}

function stopRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
    state.mediaRecorder.stop();
  }
  clearTimer();
}

function startTimerCountdown() {
  clearTimer();
  state.timer = window.setInterval(() => {
    state.remainingSeconds -= 1;
    renderTimer();
    if (state.remainingSeconds <= 0) {
      stopRecording();
    }
  }, 1000);
}

function clearTimer() {
  if (state.timer) {
    window.clearInterval(state.timer);
    state.timer = null;
  }
}

function renderTimer() {
  const min = String(Math.floor(state.remainingSeconds / 60)).padStart(2, "0");
  const sec = String(state.remainingSeconds % 60).padStart(2, "0");
  el.timerValue.textContent = `${min}:${sec}`;
}

async function submitForEvaluation() {
  if (!state.sessionId) {
    setTrainingMessage("没有可提交的会话。", true);
    return;
  }

  if (state.isRecording) {
    stopRecording();
    await waitMs(600);
  }

  const manualText = el.manualTranscript.value.trim();
  if (!state.audioBlob && !manualText) {
    setTrainingMessage("请先录音，或填写回答文本后再提交。", true);
    return;
  }

  el.submitBtn.disabled = true;
  setTrainingMessage("正在分析，请稍候...");

  try {
    if (state.audioBlob) {
      const audioBase64 = await blobToBase64(state.audioBlob);
      await apiPost("/api/session/upload-audio", {
        sessionId: state.sessionId,
        audioBase64,
        mimeType: state.audioBlob.type || "audio/webm"
      });
    }

    await apiPost("/api/session/transcribe", {
      sessionId: state.sessionId,
      transcriptText: manualText
    });

    const evaluateRes = await apiPost("/api/session/evaluate", {
      sessionId: state.sessionId
    });

    renderResult(evaluateRes.report);
    await loadHistory();
    switchTab("resultTab");
  } catch (error) {
    setTrainingMessage(error.message || "提交失败，请稍后重试。", true);
  } finally {
    el.submitBtn.disabled = false;
  }
}

function renderResult(report) {
  const dimensionLabels = {
    logic: "逻辑清晰度",
    structure: "结构完整度",
    brevity: "简洁程度",
    precision: "用词精准度",
    speaking: "口语表现",
    effectiveness: "回答有效性",
    appropriateness: "场景得体度"
  };

  el.overallScore.textContent = String(report.overall_score ?? "--");
  el.resultSummary.textContent = report.summary || "评估完成。";
  el.dimensionScores.innerHTML = "";

  Object.entries(report.dimension_scores || {}).forEach(([key, value]) => {
    const item = document.createElement("div");
    item.className = "score-item";
    item.textContent = `${dimensionLabels[key] || key}: ${value}`;
    el.dimensionScores.appendChild(item);
  });

  renderChipList(el.issueTags, report.issue_tags || []);
  renderTextList(el.detectedIssues, report.detected_issues || []);
  renderTextList(el.suggestions, report.suggestions || []);

  const guide = report.thinking_guide || {};
  el.frameworkName.textContent = `推荐框架：${guide.recommended_framework || "PREP"}`;
  renderTextList(el.frameworkOutline, guide.outline || []);

  const rewrites = report.rewrites || {};
  el.rewriteConcise.textContent = rewrites.concise || "";
  el.rewriteLogic.textContent = rewrites.high_logic || "";
  el.rewriteEq.textContent = rewrites.high_eq || "";
  el.modelAnswer.textContent = guide.model_answer || "";
}

async function loadHistory() {
  try {
    const data = await apiGet(`/api/session/history?userId=${encodeURIComponent(state.userId)}&limit=30`);
    renderHistory(data.sessions || []);
  } catch {
    renderHistory([]);
  }
}

function renderHistory(rows) {
  el.historyList.innerHTML = "";
  if (!rows.length) {
    el.historyList.innerHTML = '<p class="hint">暂无训练记录，先去首页开始一次训练吧。</p>';
    return;
  }

  rows.forEach((row) => {
    const card = document.createElement("div");
    card.className = "history-item";
    const time = new Date(row.created_at).toLocaleString();
    const score = row.overall_score ?? "--";
    card.innerHTML = `
      <h4>${escapeHtml(row.topic_title || "训练记录")}</h4>
      <p>模式：${typeLabel(row.mode_type)} | 时长：${row.duration_type} | 分数：${score}</p>
      <p>时间：${escapeHtml(time)}</p>
      <div class="chips">
        ${(row.issue_tags || []).slice(0, 3).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
      </div>
      <div class="actions">
        <button class="ghost-btn" data-session-id="${row.id}">查看详情</button>
      </div>
    `;
    el.historyList.appendChild(card);
  });
}

function renderChipList(container, items) {
  container.innerHTML = "";
  const values = items.length ? items : ["暂无明显问题标签"];
  values.forEach((item) => {
    const chip = document.createElement("span");
    chip.textContent = item;
    container.appendChild(chip);
  });
}

function renderTextList(container, items) {
  container.innerHTML = "";
  const values = items.length ? items : ["暂无"];
  values.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    container.appendChild(li);
  });
}

function resetTrainingState() {
  clearTimer();
  state.sessionId = null;
  state.audioBlob = null;
  state.audioChunks = [];
  state.remainingSeconds = state.durationType === "3min" ? 180 : 60;
  state.isRecording = false;
  el.recordStatus.textContent = "待开始";
  renderTimer();
  setTrainingMessage("");
}

function setTrainingMessage(message, isError = false) {
  el.trainingMessage.textContent = message;
  el.trainingMessage.style.color = isError ? "#b75f1d" : "#567071";
}

async function apiGet(url) {
  try {
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || "请求失败");
    }
    return data;
  } catch (error) {
    return demoApiGet(url, error);
  }
}

async function apiPost(url, body) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body || {})
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || "请求失败");
    }
    return data;
  } catch (error) {
    return demoApiPost(url, body || {}, error);
  }
}

function demoApiGet(url, originalError) {
  if (url.startsWith("/api/session/history")) {
    const query = new URL(url, window.location.origin);
    const userId = query.searchParams.get("userId") || state.userId;
    const limit = Number(query.searchParams.get("limit") || 50);
    const sessions = getDemoSessions()
      .filter((session) => session.user_id === userId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit)
      .map((session) => ({
        id: session.id,
        topic_title: session.topic?.title || "未命名题目",
        topic_content: session.topic?.content || "",
        mode_type: session.mode_type,
        duration_type: session.duration_type,
        overall_score: session.evaluation_report?.overall_score ?? null,
        issue_tags: session.evaluation_report?.issue_tags || [],
        created_at: session.created_at,
        status: session.status
      }));
    return Promise.resolve({ ok: true, sessions, source: "demo" });
  }

  const resultMatch = url.match(/^\/api\/session\/([a-zA-Z0-9-]+)\/result$/);
  if (resultMatch) {
    const session = getDemoSessions().find((item) => item.id === resultMatch[1]);
    if (!session) {
      return Promise.reject(new Error("该记录不存在"));
    }
    return Promise.resolve({ ok: true, session, report: session.evaluation_report, source: "demo" });
  }

  return Promise.reject(originalError instanceof Error ? originalError : new Error("请求失败"));
}

function demoApiPost(url, body, originalError) {
  if (url === "/api/topic/generate") {
    return Promise.resolve({ ok: true, topic: generateDemoTopic(body), source: "demo" });
  }

  if (url === "/api/session/create") {
    const sessions = getDemoSessions();
    const session = {
      id: makeDemoId(),
      user_id: body.userId || state.userId,
      mode_type: body.modeType || "logic",
      duration_type: body.durationType || "1min",
      topic: body.topic,
      audio_url: null,
      mime_type: null,
      transcript_text: "",
      speech_features: null,
      evaluation_report: null,
      status: "created",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    sessions.push(session);
    saveDemoSessions(sessions);
    return Promise.resolve({ ok: true, session, source: "demo" });
  }

  if (url === "/api/session/upload-audio") {
    const sessions = getDemoSessions();
    const session = sessions.find((item) => item.id === body.sessionId);
    if (!session) {
      return Promise.reject(new Error("session 不存在"));
    }
    session.status = "audio_uploaded";
    session.updated_at = new Date().toISOString();
    saveDemoSessions(sessions);
    return Promise.resolve({ ok: true, audio_url: null, size: 0, source: "demo" });
  }

  if (url === "/api/session/transcribe") {
    const sessions = getDemoSessions();
    const session = sessions.find((item) => item.id === body.sessionId);
    if (!session) {
      return Promise.reject(new Error("session 不存在"));
    }
    const transcriptText = String(body.transcriptText || "").trim() || "这是一个演示版会话，请粘贴回答文本后再次评估。";
    const speechFeatures = extractDemoSpeechFeatures(transcriptText);
    session.transcript_text = transcriptText;
    session.speech_features = speechFeatures;
    session.status = "transcribed";
    session.updated_at = new Date().toISOString();
    saveDemoSessions(sessions);
    return Promise.resolve({
      ok: true,
      transcript_text: transcriptText,
      speech_features: speechFeatures,
      source: "demo"
    });
  }

  if (url === "/api/session/evaluate") {
    const sessions = getDemoSessions();
    const session = sessions.find((item) => item.id === body.sessionId);
    if (!session) {
      return Promise.reject(new Error("session 不存在"));
    }
    if (!session.transcript_text) {
      return Promise.reject(new Error("请先完成转写"));
    }
    const report = evaluateDemoAnswer({
      topic: session.topic,
      mode_type: session.mode_type,
      duration_type: session.duration_type,
      transcript_text: session.transcript_text,
      speech_features: session.speech_features
    });
    session.evaluation_report = report;
    session.status = "evaluated";
    session.updated_at = new Date().toISOString();
    saveDemoSessions(sessions);
    return Promise.resolve({ ok: true, report, source: "demo" });
  }

  return Promise.reject(originalError instanceof Error ? originalError : new Error("请求失败"));
}

function getDemoSessions() {
  try {
    return JSON.parse(localStorage.getItem(DEMO_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveDemoSessions(sessions) {
  localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(sessions));
}

function makeDemoId() {
  return `demo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateDemoTopic(input) {
  const mode = input.modeType || "logic";
  const pools = {
    logic: [
      "你认为一个团队效率低下的最核心原因是什么？",
      "为什么有些人很努力却成长缓慢？",
      "你如何判断一个方案是可执行而不是空想？"
    ],
    improv: [
      "如果你临时要在会议上汇报项目风险，你会怎么开场？",
      "今天让你接手一个延期项目，你第一步会做什么？",
      "面对领导突然提问，你如何在30秒内组织回答？"
    ],
    scenario: [
      "领导临时让你周末加班，但你已有安排，你会如何回应？",
      "同事频繁把任务推给你，你如何拒绝且不伤关系？",
      "你需要向上级争取资源，如何更有说服力地表达请求？"
    ]
  };
  const frameworks = {
    logic: "结论-原因-例子-总结",
    improv: "PREP",
    scenario: "非暴力沟通"
  };
  const labels = {
    logic: "逻辑表达训练题",
    improv: "即兴表达训练题",
    scenario: "场景表达训练题"
  };
  const list = pools[mode] || pools.logic;

  return {
    title: labels[mode] || "表达训练题",
    content: list[Math.floor(Math.random() * list.length)],
    topic_type: mode,
    difficulty: input.difficulty || "intermediate",
    target_skill: input.targetSkill || "logic",
    suggested_framework: frameworks[mode] || "PREP",
    recommended_duration: input.durationType || "1min",
    training_goal: "提升结构化表达能力"
  };
}

function extractDemoSpeechFeatures(text) {
  const fillers = ["嗯", "啊", "那个", "然后", "就是", "其实"];
  let fillerCount = 0;
  fillers.forEach((word) => {
    const matches = String(text || "").match(new RegExp(word, "g"));
    fillerCount += matches ? matches.length : 0;
  });

  const charCount = String(text || "").replace(/\s+/g, "").length;
  return {
    char_count: charCount,
    filler_count: fillerCount,
    filler_ratio: charCount ? Number((fillerCount / charCount).toFixed(4)) : 0,
    repetition_ratio: 0,
    estimated_pause_seconds: Number((fillerCount * 0.2).toFixed(2))
  };
}

function evaluateDemoAnswer(payload) {
  const transcript = String(payload.transcript_text || "").trim();
  const features = payload.speech_features || extractDemoSpeechFeatures(transcript);
  const hasConclusion = /(我认为|我的结论|总结来说|结论是|我会先)/.test(transcript);
  const hasStructure = /(第一|第二|第三|首先|其次|最后)/.test(transcript);
  const hasEvidence = /(例如|比如|数据|案例|结果|所以|因为)/.test(transcript);
  const politeness = /(请|感谢|抱歉|理解|辛苦)/.test(transcript);
  const length = transcript.length;

  const logic = clampDemoScore(66 + (hasConclusion ? 14 : -4) + (hasStructure ? 8 : -2));
  const structure = clampDemoScore(64 + (hasStructure ? 16 : -5));
  const brevity = clampDemoScore(78 - Math.max(0, Math.floor((length - 260) / 18)));
  const precision = clampDemoScore(65 + (hasEvidence ? 10 : -1));
  const speaking = clampDemoScore(72 - Math.min(20, Math.round(features.filler_ratio * 120)));
  const effectiveness = clampDemoScore(68 + (hasEvidence ? 10 : -3) + (hasConclusion ? 6 : -3));
  const appropriateness = clampDemoScore(payload.mode_type === "scenario" ? (politeness ? 80 : 66) : 75);
  const overall = clampDemoScore(
    Math.round(logic * 0.2 + structure * 0.15 + brevity * 0.15 + precision * 0.15 + speaking * 0.15 + effectiveness * 0.2)
  );

  const issueTags = [];
  const detectedIssues = [];
  if (!hasConclusion) {
    issueTags.push("结论不先行");
    detectedIssues.push("开头缺少直接结论，听者需要花更久抓重点。");
  }
  if (!hasStructure) {
    issueTags.push("分点不明确");
    detectedIssues.push("建议用“第一、第二、第三”让结构更清楚。");
  }
  if (!hasEvidence) {
    issueTags.push("例子不足");
    detectedIssues.push("可以补一个真实案例，让表达更有说服力。");
  }
  if (features.filler_ratio > 0.02) {
    issueTags.push("犹豫词偏多");
    detectedIssues.push("减少“嗯、然后、就是”等填充词，表达会更干净。");
  }

  return {
    overall_score: overall,
    dimension_scores: {
      logic,
      structure,
      brevity,
      precision,
      speaking,
      effectiveness,
      appropriateness
    },
    detected_issues: detectedIssues,
    issue_tags: issueTags,
    strengths: [
      hasConclusion ? "能够先表达核心观点" : "已经有基本表达主线",
      hasEvidence ? "回答中有支撑信息，可信度更高" : "整体表达自然，继续打磨结构会提升很快"
    ],
    suggestions: [
      "第一句话先讲结论，再用 2-3 个分点展开。",
      "每个分点补一个例子或场景，让内容更具体。",
      "卡顿时先停 1 秒，不要用填充词占位。"
    ],
    thinking_guide: {
      first_think: [
        "先确定你的核心结论。",
        "拆成 2-3 个支持点。",
        "每个点都准备一个例子。"
      ],
      question_type: typeLabel(payload.mode_type),
      recommended_framework: payload.mode_type === "scenario" ? "非暴力沟通" : "PREP",
      outline: [
        "结论：先给出你的判断。",
        "分点一：原因或原则。",
        "分点二：例子或行动。",
        "总结：重申结论。"
      ],
      model_answer:
        normalizeDuration(payload.duration_type) === "1min"
          ? "我的结论是，这个问题的关键在于先明确目标，再快速给出两到三项可执行动作。第一，统一优先级，避免重复投入；第二，建立反馈机制，让问题及时暴露；第三，用具体场景说明方案如何落地。"
          : "我先给结论：解决这个问题，关键不是说得多，而是说得有结构。第一，先明确核心目标，让听者快速知道重点。第二，用两到三个分点展开，每一点只讲一件事。第三，通过案例补足说服力，让内容不空泛。最后，再用一句话收束观点，这样表达会更清楚也更有影响力。"
    },
    rewrites: {
      concise: "我认为，这个问题最重要的是先明确结论，再围绕两到三点展开，避免信息分散。",
      high_logic: "我的结论是：要把这个问题说清楚，需要三步。第一，先讲结论；第二，分点展开；第三，用例子支撑，让表达更有说服力。",
      high_eq:
        payload.mode_type === "scenario"
          ? "我理解当前场景的敏感性，也愿意积极配合。为了让沟通更顺畅，我建议我们先对齐目标，再讨论具体安排。"
          : "如果希望表达更容易被接受，可以先讲结论，再用具体例子解释原因，最后补一句行动建议。"
    },
    summary: overall >= 75 ? "这次表达已经有基础框架了，继续压缩废话、补强例子会更好。" : "先把“结论先行 + 分点展开”练稳，你的进步会很明显。"
  };
}

function clampDemoScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeDuration(value) {
  return String(value || "").includes("3") ? "3min" : "1min";
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("音频编码失败"));
        return;
      }
      resolve(reader.result.split(",")[1] || reader.result);
    };
    reader.onerror = () => reject(new Error("音频读取失败"));
    reader.readAsDataURL(blob);
  });
}

function typeLabel(type) {
  const map = {
    logic: "逻辑表达",
    improv: "即兴表达",
    scenario: "场景表达",
    debate: "辩论",
    roleplay: "角色扮演"
  };
  return map[type] || type;
}

function difficultyLabel(level) {
  const map = {
    beginner: "初级",
    intermediate: "中级",
    advanced: "高级"
  };
  return map[level] || level;
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
