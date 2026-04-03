import crypto from "crypto";

const AI_API_KEY = String(process.env.SILICONFLOW_API_KEY || process.env.OPENAI_API_KEY || "").trim();
const AI_BASE_URL = String(process.env.SILICONFLOW_BASE_URL || "https://api.siliconflow.cn/v1").trim();
const AI_MODEL = String(process.env.SILICONFLOW_MODEL || process.env.OPENAI_MODEL || "qwen3.5").trim();

// Demo deployment keeps sessions in memory so the public preview works
// without a database. This is enough for a shareable MVP URL.
const globalStore = globalThis.__speakbetter_store ?? { sessions: [] };
globalThis.__speakbetter_store = globalStore;

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    const requestUrl = new URL(req.url || "/", "https://speakbetter.vercel.app");
    const pathname = requestUrl.pathname;

    if (req.method === "GET" && pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        service: "speakbetter-mvp-vercel",
        openaiEnabled: Boolean(AI_API_KEY),
        serverTime: new Date().toISOString()
      });
    }

    if (req.method === "POST" && pathname === "/api/auth/login") {
      const body = await parseJsonBody(req);
      const email = String(body.email || "demo@speakbetter.local");
      const id = `user_${crypto.createHash("md5").update(email).digest("hex").slice(0, 8)}`;
      return sendJson(res, 200, {
        ok: true,
        token: `demo-token-${id}`,
        user: {
          id,
          email,
          nickname: email.split("@")[0] || "SpeakBetter 用户"
        }
      });
    }

    if (req.method === "GET" && pathname === "/api/user/profile") {
      const userId = requestUrl.searchParams.get("userId") || "user_demo";
      const userSessions = globalStore.sessions.filter((session) => session.user_id === userId);
      return sendJson(res, 200, {
        ok: true,
        profile: {
          id: userId,
          nickname: "SpeakBetter 学员",
          total_sessions: userSessions.length,
          created_at: userSessions.at(-1)?.created_at || new Date().toISOString()
        }
      });
    }

    if (req.method === "POST" && pathname === "/api/topic/generate") {
      const body = await parseJsonBody(req);
      const input = {
        mode_type: normalizeModeType(body.modeType || body.mode_type || "logic"),
        difficulty: normalizeDifficulty(body.difficulty || "intermediate"),
        duration_type: normalizeDurationType(body.durationType || body.duration_type || "1min"),
        target_skill: normalizeTargetSkill(body.targetSkill || body.target_skill || "logic"),
        weakness_tags: Array.isArray(body.weaknessTags || body.weakness_tags)
          ? (body.weaknessTags || body.weakness_tags)
          : []
      };

      const aiTopic = await generateTopicWithAI(input).catch(() => null);
      const topic = aiTopic || generateTopicFallback(input);

      return sendJson(res, 200, {
        ok: true,
        topic,
        source: aiTopic ? "openai" : "fallback"
      });
    }

    if (req.method === "GET" && pathname === "/api/topic/recommend") {
      const modeType = normalizeModeType(requestUrl.searchParams.get("modeType") || "logic");
      const durationType = normalizeDurationType(requestUrl.searchParams.get("durationType") || "1min");
      const topics = Array.from({ length: 3 }).map((_, idx) =>
        generateTopicFallback({
          mode_type: modeType,
          difficulty: "intermediate",
          duration_type: durationType,
          target_skill: "logic",
          weakness_tags: [],
          seedOffset: idx
        })
      );

      return sendJson(res, 200, { ok: true, topics });
    }

    if (req.method === "POST" && pathname === "/api/session/create") {
      const body = await parseJsonBody(req);
      const userId = String(body.userId || body.user_id || "user_demo");
      const topic = body.topic;

      if (!topic || !topic.title || !topic.content) {
        return sendJson(res, 400, { ok: false, message: "缺少 topic 信息" });
      }

      const session = {
        id: crypto.randomUUID(),
        user_id: userId,
        mode_type: normalizeModeType(body.modeType || body.mode_type || topic.topic_type || "logic"),
        duration_type: normalizeDurationType(
          body.durationType || body.duration_type || topic.recommended_duration || "1min"
        ),
        topic,
        audio_url: null,
        mime_type: null,
        transcript_text: "",
        speech_features: null,
        evaluation_report: null,
        status: "created",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      globalStore.sessions.push(session);
      return sendJson(res, 200, { ok: true, session });
    }

    if (req.method === "POST" && pathname === "/api/session/upload-audio") {
      const body = await parseJsonBody(req, 25 * 1024 * 1024);
      const session = findSessionById(body.sessionId || body.session_id);

      if (!session) {
        return sendJson(res, 404, { ok: false, message: "session 不存在" });
      }

      session.audio_url = null;
      session.mime_type = String(body.mimeType || body.mime_type || "audio/webm");
      session.status = "audio_uploaded";
      session.updated_at = new Date().toISOString();

      return sendJson(res, 200, {
        ok: true,
        audio_url: null,
        size: String(body.audioBase64 || body.audio_base64 || "").length
      });
    }

    if (req.method === "POST" && pathname === "/api/session/transcribe") {
      const body = await parseJsonBody(req);
      const session = findSessionById(body.sessionId || body.session_id);

      if (!session) {
        return sendJson(res, 404, { ok: false, message: "session 不存在" });
      }

      const manualText = String(body.transcriptText || body.transcript_text || "").trim();
      const transcriptText = manualText || "未启用在线转写，请粘贴你的回答文本继续评估。";
      const speechFeatures = extractSpeechFeatures(transcriptText);

      session.transcript_text = transcriptText;
      session.speech_features = speechFeatures;
      session.status = "transcribed";
      session.updated_at = new Date().toISOString();

      return sendJson(res, 200, {
        ok: true,
        transcript_text: transcriptText,
        speech_features: speechFeatures,
        source: manualText ? "manual" : "fallback"
      });
    }

    if (req.method === "POST" && pathname === "/api/session/evaluate") {
      const body = await parseJsonBody(req);
      const session = findSessionById(body.sessionId || body.session_id);

      if (!session) {
        return sendJson(res, 404, { ok: false, message: "session 不存在" });
      }

      if (!session.transcript_text || !session.transcript_text.trim()) {
        return sendJson(res, 400, { ok: false, message: "请先完成转写" });
      }

      const payload = {
        topic: session.topic,
        mode_type: session.mode_type,
        duration_type: session.duration_type,
        transcript_text: session.transcript_text,
        speech_features: session.speech_features
      };

      const aiReport = await evaluateWithAI(payload).catch(() => null);
      const report = aiReport || evaluateFallback(payload);

      session.evaluation_report = report;
      session.status = "evaluated";
      session.updated_at = new Date().toISOString();

      return sendJson(res, 200, { ok: true, report, source: aiReport ? "openai" : "fallback" });
    }

    const resultMatch = pathname.match(/^\/api\/session\/([a-zA-Z0-9\-]+)\/result$/);
    if (req.method === "GET" && resultMatch) {
      const session = findSessionById(resultMatch[1]);
      if (!session) {
        return sendJson(res, 404, { ok: false, message: "session 不存在" });
      }

      return sendJson(res, 200, {
        ok: true,
        session,
        report: session.evaluation_report
      });
    }

    if (req.method === "GET" && pathname === "/api/session/history") {
      const userId = String(requestUrl.searchParams.get("userId") || "user_demo");
      const limit = Number(requestUrl.searchParams.get("limit") || 50);

      const sessions = globalStore.sessions
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

      return sendJson(res, 200, { ok: true, sessions });
    }

    return sendJson(res, 404, { ok: false, message: "未找到 API" });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      message: "服务器内部错误",
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function generateTopicWithAI(input) {
  if (!AI_API_KEY) return null;

  const prompt = [
    "你是 SpeakBetter 的题目生成引擎。",
    "请生成 1 道高质量中文口语训练题，只返回 JSON。",
    JSON.stringify(input)
  ].join("\n");

  const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`
    },
    body: JSON.stringify({
      model: AI_MODEL,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!response.ok) {
    return null;
  }

  const json = await response.json();
  const content = safeJsonParse(json?.choices?.[0]?.message?.content || "{}");
  if (!content?.title || !content?.content) {
    return null;
  }

  return {
    title: String(content.title),
    content: String(content.content),
    topic_type: normalizeModeType(content.topic_type || input.mode_type),
    difficulty: normalizeDifficulty(content.difficulty || input.difficulty),
    target_skill: normalizeTargetSkill(content.target_skill || input.target_skill),
    suggested_framework: String(content.suggested_framework || "PREP"),
    recommended_duration: normalizeDurationType(content.recommended_duration || input.duration_type),
    training_goal: String(content.training_goal || "训练结构化表达")
  };
}

async function evaluateWithAI(payload) {
  if (!AI_API_KEY) return null;

  const prompt = [
    "你是专业的中文口语表达教练。",
    "请对用户回答做结构化评估，只返回 JSON。",
    JSON.stringify(payload)
  ].join("\n");

  const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`
    },
    body: JSON.stringify({
      model: AI_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!response.ok) {
    return null;
  }

  const json = await response.json();
  const content = safeJsonParse(json?.choices?.[0]?.message?.content || "{}");
  if (!content || typeof content !== "object") {
    return null;
  }

  return normalizeReport(content, payload);
}

function generateTopicFallback(input) {
  const mode = normalizeModeType(input.mode_type || "logic");
  const duration = normalizeDurationType(input.duration_type || "1min");
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

  const indexSeed = Math.floor(Math.random() * 1000) + Number(input.seedOffset || 0);
  const list = pools[mode] || pools.logic;
  const content = list[indexSeed % list.length];
  const frameworkMap = {
    logic: "结论-原因-例子-总结",
    improv: "PREP",
    scenario: "非暴力沟通"
  };

  return {
    title: `${modeLabel(mode)}训练题`,
    content,
    topic_type: mode,
    difficulty: normalizeDifficulty(input.difficulty || "intermediate"),
    target_skill: normalizeTargetSkill(input.target_skill || "logic"),
    suggested_framework: frameworkMap[mode],
    recommended_duration: duration,
    training_goal: `${modeLabel(mode)}能力强化`
  };
}

function evaluateFallback(payload) {
  const transcript = String(payload.transcript_text || "").trim();
  const features = payload.speech_features || extractSpeechFeatures(transcript);
  const hasConclusion = /(我认为|我的结论|总结来说|结论是|我会先)/.test(transcript);
  const hasStructure = /(第一|第二|第三|首先|其次|最后)/.test(transcript);
  const hasEvidence = /(例如|比如|数据|案例|结果|所以|因为)/.test(transcript);
  const politeness = /(请|感谢|抱歉|理解|辛苦)/.test(transcript);
  const length = transcript.length;
  const brevityPenalty = Math.max(0, Math.floor((length - 260) / 20));

  let logic = 65 + (hasConclusion ? 12 : -4) + (hasStructure ? 8 : -3);
  let structure = 64 + (hasStructure ? 15 : -6);
  let brevity = 75 - brevityPenalty - Math.min(18, Math.round(features.filler_ratio * 100));
  let precision = 65 + (hasEvidence ? 10 : -2);
  let speaking = 72 - Math.min(25, Math.round(features.filler_ratio * 120));
  let effectiveness = 66 + (hasEvidence ? 12 : -4) + (hasConclusion ? 6 : -5);
  let appropriateness = payload.mode_type === "scenario" ? (politeness ? 78 : 62) : 75;

  logic = clampScore(logic);
  structure = clampScore(structure);
  brevity = clampScore(brevity);
  precision = clampScore(precision);
  speaking = clampScore(speaking);
  effectiveness = clampScore(effectiveness);
  appropriateness = clampScore(appropriateness);

  const overall = clampScore(
    Math.round(
      logic * 0.2 +
        structure * 0.15 +
        brevity * 0.15 +
        precision * 0.15 +
        speaking * 0.15 +
        effectiveness * 0.2
    )
  );

  const issueTags = [];
  const detected = [];
  if (!hasConclusion) {
    issueTags.push("结论不先行");
    detected.push("回答开头没有直接给出观点，建议先结论后展开。");
  }
  if (!hasStructure) {
    issueTags.push("分点不明确");
    detected.push("建议使用‘第一、第二、第三’等结构词提高可听性。");
  }
  if (features.filler_ratio > 0.025) {
    issueTags.push("犹豫词偏多");
    detected.push("填充词偏多，影响表达干净度和专业感。");
  }
  if (!hasEvidence) {
    issueTags.push("例子不足");
    detected.push("缺少具体案例或依据，论证说服力偏弱。");
  }
  if (length > 320) {
    issueTags.push("废话较多");
    detected.push("表达偏长，可压缩重复句并聚焦关键点。");
  }
  if (payload.mode_type === "scenario" && !politeness) {
    issueTags.push("对上沟通不够得体");
    detected.push("场景表达中礼貌与边界感不足，可增加缓冲和共情语句。");
  }

  const strengths = [];
  if (logic >= 75) strengths.push("观点主线相对清晰，能围绕题目作答");
  if (effectiveness >= 75) strengths.push("能够回应问题核心，并给出一定理由");
  if (speaking >= 72) strengths.push("整体语气自然，口语流畅度较好");
  if (!strengths.length) strengths.push("你已经完成了完整表达，这是持续进步的基础");

  const suggestions = [];
  if (issueTags.includes("结论不先行")) suggestions.push("第一句话先给结论，再展开 2-3 个分点。");
  if (issueTags.includes("分点不明确")) suggestions.push("用‘第一、第二、第三’组织段落，每点一句中心句。");
  if (issueTags.includes("例子不足")) suggestions.push("每个观点补一个真实场景例子，提升可信度。");
  if (issueTags.includes("犹豫词偏多")) suggestions.push("遇到卡顿先停 1 秒，不用‘嗯、然后、就是’填空。");
  if (issueTags.includes("废话较多")) suggestions.push("删掉重复句，控制在‘结论+3点+总结’框架内。");
  if (issueTags.includes("对上沟通不够得体")) suggestions.push("先表达理解，再提出诉求，最后给可执行方案。");
  if (suggestions.length < 3) suggestions.push("回答前先写 3 个关键词，避免想到哪说到哪。");

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
    detected_issues: detected,
    issue_tags: issueTags,
    strengths,
    suggestions,
    thinking_guide: {
      ...buildThinkingGuide(payload.topic, payload.mode_type),
      model_answer: buildModelAnswer(payload.topic, payload.duration_type)
    },
    rewrites: buildRewrites(transcript, payload.mode_type, payload.topic),
    summary: buildSummary(overall, issueTags)
  };
}

function normalizeReport(raw, payload) {
  const fallback = evaluateFallback(payload);
  const merged = {
    ...fallback,
    ...raw,
    dimension_scores: {
      ...fallback.dimension_scores,
      ...(raw.dimension_scores || {})
    },
    thinking_guide: {
      ...fallback.thinking_guide,
      ...(raw.thinking_guide || {})
    },
    rewrites: {
      ...fallback.rewrites,
      ...(raw.rewrites || {})
    }
  };

  merged.overall_score = clampScore(Number(merged.overall_score || fallback.overall_score));
  for (const key of Object.keys(merged.dimension_scores)) {
    merged.dimension_scores[key] = clampScore(Number(merged.dimension_scores[key] || fallback.dimension_scores[key]));
  }

  merged.detected_issues = ensureStringArray(merged.detected_issues, fallback.detected_issues);
  merged.issue_tags = ensureStringArray(merged.issue_tags, fallback.issue_tags);
  merged.strengths = ensureStringArray(merged.strengths, fallback.strengths);
  merged.suggestions = ensureStringArray(merged.suggestions, fallback.suggestions);
  merged.summary = String(merged.summary || fallback.summary);

  if (!merged.thinking_guide.model_answer) {
    merged.thinking_guide.model_answer = buildModelAnswer(payload.topic, payload.duration_type);
  }

  return merged;
}

function buildThinkingGuide(topic, modeType) {
  const question = topic?.content || "当前题目";
  return {
    first_think: [
      "先用一句话给出立场或结论。",
      "拆成 2-3 个分点，每点只讲一件事。",
      "每个分点配一个具体场景或例子。"
    ],
    question_type: `${modeLabel(modeType)}题`,
    recommended_framework: modeType === "scenario" ? "非暴力沟通" : "PREP",
    outline: [
      `结论：我对“${question}”的核心观点是……`,
      "分点一：核心原因/判断依据。",
      "分点二：具体做法与例子。",
      "总结：重申观点并给出下一步。"
    ]
  };
}

function buildModelAnswer(topic, durationType) {
  const content = topic?.content || "这个问题";
  if (normalizeDurationType(durationType) === "1min") {
    return `我的结论是：面对“${content}”，关键在于先明确目标，再用两步执行。第一步，先对齐优先级，避免资源分散；第二步，建立可复盘的反馈机制，让问题在小范围内被及时修正。这样既能保证效率，也能让团队持续改进。`;
  }

  return `我先给结论：针对“${content}”，最有效的做法是“目标清晰、分工明确、反馈闭环”。第一，目标清晰。没有统一目标，团队会出现重复劳动和方向偏差。第二，分工明确。每个人知道自己负责什么、交付标准是什么，协作成本会明显下降。第三，反馈闭环。每周做短复盘，及时纠偏，避免小问题积压成大风险。总结来说，效率不是靠加班堆出来的，而是靠结构化协作设计出来的。`;
}

function buildRewrites(_, modeType, topic) {
  return {
    concise: "我认为，这个问题的关键是先明确目标，再聚焦两到三项最重要动作，避免无效沟通和重复工作。",
    high_logic: `我的结论是：要解决“${topic?.content || "该问题"}”，应从三点入手。第一，统一目标，减少方向偏差；第二，优化协作机制，降低沟通成本；第三，建立复盘反馈，确保持续改进。`,
    high_eq:
      modeType === "scenario"
        ? "我理解当前的紧急性，也愿意配合推进。为了保证结果质量，我建议我们先明确优先级和时间节点，我会在这个框架下尽快给出可执行方案。"
        : "在表达观点时，我会先说明结论，再用具体例子解释原因，最后补一句行动建议，确保对方听得懂、愿意采纳。"
  };
}

function buildSummary(score, issueTags) {
  if (score >= 85) return "整体表达成熟，建议继续强化细节例证，冲击更高稳定性。";
  if (score >= 70) return "基础结构已经具备，重点优化结论先行和表达简洁度。";
  if (issueTags.length > 0) return `当前主要短板是：${issueTags.slice(0, 2).join("、")}。按建议重练可快速提升。`;
  return "建议先从结论先行+三点展开开始，逐步建立稳定表达框架。";
}

function extractSpeechFeatures(text) {
  const normalized = String(text || "");
  const fillers = ["嗯", "啊", "那个", "然后", "就是", "其实", "这个", "怎么说", "你知道"];
  let fillerCount = 0;

  for (const word of fillers) {
    const matches = normalized.match(new RegExp(escapeRegExp(word), "g"));
    fillerCount += matches ? matches.length : 0;
  }

  const charCount = normalized.replace(/\s+/g, "").length;
  const fillerRatio = charCount ? fillerCount / charCount : 0;
  const sentences = normalized
    .split(/[。！？!?\n]/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  let repeated = 0;
  const seen = new Set();
  for (const sentence of sentences) {
    if (seen.has(sentence)) repeated += 1;
    seen.add(sentence);
  }

  const repetitionRatio = sentences.length ? repeated / sentences.length : 0;
  const punctuationCount = (normalized.match(/[，。！？、,!?]/g) || []).length;
  const estimatedPause = Number((punctuationCount * 0.35 + fillerCount * 0.15).toFixed(2));

  return {
    char_count: charCount,
    filler_count: fillerCount,
    filler_ratio: Number(fillerRatio.toFixed(4)),
    repetition_ratio: Number(repetitionRatio.toFixed(4)),
    estimated_pause_seconds: estimatedPause
  };
}

function findSessionById(id) {
  const sid = String(id || "");
  if (!sid) return null;
  return globalStore.sessions.find((session) => session.id === sid) || null;
}

function normalizeModeType(value) {
  const v = String(value || "logic").toLowerCase();
  if (["logic", "improv", "scenario", "debate", "roleplay"].includes(v)) return v;
  if (v.includes("即兴")) return "improv";
  if (v.includes("场景") || v.includes("情商")) return "scenario";
  return "logic";
}

function normalizeDifficulty(value) {
  const v = String(value || "intermediate").toLowerCase();
  if (["beginner", "intermediate", "advanced"].includes(v)) return v;
  if (v.includes("初")) return "beginner";
  if (v.includes("高")) return "advanced";
  return "intermediate";
}

function normalizeDurationType(value) {
  const v = String(value || "1min").toLowerCase();
  if (["1min", "3min"].includes(v)) return v;
  if (v.includes("3")) return "3min";
  return "1min";
}

function normalizeTargetSkill(value) {
  const v = String(value || "logic").toLowerCase();
  if (["logic", "brevity", "precision", "eq", "improv"].includes(v)) return v;
  return "logic";
}

function modeLabel(mode) {
  const labels = {
    logic: "逻辑表达",
    improv: "即兴表达",
    scenario: "场景表达",
    debate: "辩论",
    roleplay: "角色扮演"
  };
  return labels[mode] || "表达";
}

function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 60;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function ensureStringArray(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const arr = value.map((item) => String(item).trim()).filter(Boolean);
  return arr.length ? arr : fallback;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function parseJsonBody(req, maxSize = 5 * 1024 * 1024) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxSize) {
      throw new Error("请求体过大");
    }
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf-8").trim();
  if (!text) return {};
  return JSON.parse(text);
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}
