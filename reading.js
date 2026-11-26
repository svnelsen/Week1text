"use strict";

const get = id => document.getElementById(id);
const story = get("story");
const rulePanel = get("rule-panel");
const sentences = [];
const wordButtons = [];
const lampButtons = [];
const wordPattern = /[a-z]+(?:[’'][a-z]+)?/gi;
const motion = matchMedia("(prefers-reduced-motion: reduce)");
const soundFolder = "assets/audio/phonics/";
const imageFolder = "assets/images/";
const narration = edition.narration;
const narrationReady = Boolean(narration.src) &&
  narration.starts.length === storyLines.length &&
  narration.starts.every((start, index, starts) =>
    Number.isFinite(start) && start >= 0 && (index === 0 || start > starts[index - 1]));

let colors = true;
let lamps = false;
let report = false;
let language = "en";
let active = null;
let storyTime = 0;
let highlight = null;
let hint = null;
let statusTimer;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function button(text, action) {
  const control = node("button", "", text);
  control.type = "button";
  control.addEventListener("click", action);
  return control;
}

function image(name, alt, lazy = true) {
  const element = node("img");
  element.src = imageFolder + name + ".webp";
  element.alt = alt;
  if (lazy) element.loading = "lazy";
  return element;
}

function message(text) {
  const status = get("status");
  clearTimeout(statusTimer);
  status.hidden = false;
  status.textContent = text;
  statusTimer = setTimeout(() => { status.hidden = true; }, 3500);
}

function clearHighlight() {
  highlight?.classList.remove("sounding");
  highlight = null;
}

function stop() {
  if (active) {
    const playback = active;
    active = null;
    playback.audio.pause();
    cancelAnimationFrame(playback.frame);
    if (playback.kind === "story" && Number.isFinite(playback.audio.currentTime)) {
      storyTime = playback.audio.currentTime;
    }
  }
  clearHighlight();
  syncControls();
}

function updateSentence(playback) {
  if (active !== playback || playback.audio.paused) return;
  const index = narration.starts.findLastIndex(start => start <= playback.audio.currentTime);
  const target = index < 0 && playback.audio.currentTime >= narration.titleStart
    ? get("story-title") : sentences[index];
  if (target !== highlight) {
    clearHighlight();
    if (target) {
      highlight = target;
      target.classList.add("sounding");
      const rect = target.getBoundingClientRect();
      if (rect.top < 75 || rect.bottom > innerHeight - 75) {
        target.scrollIntoView({ block: "center", behavior: motion.matches ? "auto" : "smooth" });
      }
    }
  }
  playback.frame = requestAnimationFrame(() => updateSentence(playback));
}

function playAudio(src, kind, target = null, offset = 0) {
  stop();
  const audio = new Audio();
  const playback = { audio, kind, frame: 0 };
  active = playback;
  const fail = () => {
    if (active !== playback) return;
    stop();
    message("Не удалось воспроизвести запись.");
  };
  audio.addEventListener("error", fail, { once: true });
  audio.addEventListener("playing", () => {
    if (active !== playback) return;
    if (kind === "story") {
      cancelAnimationFrame(playback.frame);
      updateSentence(playback);
    } else if (target) {
      highlight = target;
      target.classList.add("sounding");
    }
  });
  audio.addEventListener("ended", () => {
    if (active !== playback) return;
    stop();
    if (kind === "story") {
      storyTime = 0;
      syncControls();
    }
  }, { once: true });
  audio.src = src;
  if (offset) audio.currentTime = offset;
  audio.play().catch(fail);
  syncControls();
}

function renderWords(text, parent, hintAnchor) {
  let previous = 0;
  for (const match of text.matchAll(wordPattern)) {
    const spelling = match[0];
    const key = spelling.toLowerCase().replace("'", "’");
    const wrap = node("span", "word-wrap");
    const control = button("", () => {
      const src = edition.wordAudio[key];
      if (src) playAudio(src, "word", control);
      else { stop(); message("Запись этого слова ещё готовится."); }
    });
    control.className = "word";
    wordButtons.push(control);

    const marks = edition.marks[key] || [];
    let cursor = 0;
    for (const [start, length, rule] of marks) {
      control.append(spelling.slice(cursor, start));
      const mark = node("span", "mark", spelling.slice(start, start + length));
      mark.style.setProperty("--rule-color", "var(--" + rule + ")");
      control.append(mark);
      cursor = start + length;
    }
    control.append(spelling.slice(cursor));
    wrap.append(control);
    if (marks.length) {
      const keys = [...new Set(marks.map(mark => mark[2]))];
      const lamp = button("💡", () => openHint(lamp, hintAnchor, keys));
      lamp.className = "lamp";
      lamp.setAttribute("aria-label", "Правило для слова " + spelling);
      lamp.setAttribute("aria-expanded", "false");
      lamp.hidden = true;
      lampButtons.push(lamp);
      wrap.append(lamp);
    }
    const next = match.index + spelling.length;
    // Closing punctuation travels with the word without becoming part of its button.
    const ending = text.slice(next).match(/^[.,!?;:”]+/u)?.[0] || "";
    wrap.append(ending);
    parent.append(text.slice(previous, match.index), wrap);
    previous = next + ending.length;
  }
  parent.append(text.slice(previous));
}

function buildStory() {
  const title = get("story-title");
  const translated = language === "ru";
  title.replaceChildren();
  story.replaceChildren();
  get("cover").replaceChildren();
  wordButtons.length = lampButtons.length = sentences.length = 0;
  title.lang = story.lang = language;
  if (translated) title.textContent = edition.translation.title;
  else renderWords(edition.title, title, title);
  let paragraphIndex = 0;
  for (const [index, scene] of edition.scenes.entries()) {
    const section = node("section", "scene" + (index ? " illustrated" : ""));
    const figure = node("figure");
    figure.append(image(scene.image, scene.alt, index !== 0));
    (index ? section : get("cover")).append(figure);
    const copy = node("div", "scene-text");
    section.prepend(copy);
    for (const [start, end] of scene.groups) {
      const paragraph = node("p", "paragraph");
      if (translated) paragraph.textContent = edition.translation.paragraphs[paragraphIndex];
      else for (let line = start; line < end; line++) {
        if (line > start) paragraph.append(" ");
        const span = node("span", "sentence");
        renderWords(storyLines[line], span, paragraph);
        sentences[line] = span;
        paragraph.append(span);
      }
      copy.append(paragraph);
      paragraphIndex++;
    }
    story.append(section);
  }
}

function house(open) {
  const art = node("span", "house-art " + (open ? "open" : "closed"));
  art.setAttribute("aria-hidden", "true");
  const walls = node("span", "walls");
  const doorway = node("span", "doorway");
  doorway.append(node("span", "door"));
  walls.append(node("span", "window"), doorway, node("span", "lock", open ? "🔓" : "🔒"));
  art.append(node("span", "roof"), walls);
  return art;
}

function buildRules(panel, keys) {
  const selector = node("div", "controls");
  const body = node("div", "rule-body");
  const options = [];
  function show(key) {
    const [label, tip, examples, sound, art] = edition.rules[key];
    for (const item of options) item.setAttribute("aria-pressed", String(item.dataset.rule === key));
    body.replaceChildren(art ? image(art, "Иллюстрация из урока") : house(key === "open"));
    if (key === "wh-w" || key === "wh-h" || key.startsWith("th-")) body.querySelector("img").classList.add("lesson-slide");
    const copy = node("div", "rule-copy");
    copy.style.setProperty("--rule-color", "var(--" + key + ", var(--purple))");
    const example = node("p", "", examples.join(" · "));
    example.lang = "en";
    const soundLabel = { open: "🔊 Послушать /iː/", closed: "🔊 Послушать /ɪ/" }[key] || "🔊 Послушать звук";
    copy.append(node("h3", "", label), node("p", "", tip), example,
      button(soundLabel, () => playAudio(soundFolder + sound + ".mp3", "rule")));
    body.append(copy);
  }
  if (keys.length > 1) {
    for (const key of keys) {
      const tab = button(edition.rules[key][0], () => show(key));
      tab.dataset.rule = key;
      options.push(tab);
      selector.append(tab);
    }
    panel.append(selector);
  }
  panel.append(body);
  show(keys[0]);
}

function closeHint() {
  if (!hint) return;
  hint.control.setAttribute("aria-expanded", "false");
  hint.panel.remove();
  hint = null;
}

function openHint(control, anchor, keys) {
  const alreadyOpen = hint?.control === control;
  closeHint();
  if (alreadyOpen) return;
  const panel = node("section", "hint-detail");
  panel.lang = "ru";
  panel.setAttribute("aria-label", "Подсказка для слова");
  const close = button("Закрыть подсказку", () => {
    closeHint();
    control.focus({ preventScroll: true });
  });
  panel.append(close);
  buildRules(panel, keys);
  anchor.after(panel);
  hint = { control, panel };
  control.setAttribute("aria-expanded", "true");
  panel.querySelector("button").focus({ preventScroll: true });
}

function syncControls() {
  const playing = active?.kind === "story";
  get("play").disabled = !narrationReady || report || playing;
  get("pause").disabled = !playing;
  get("resume").disabled = !narrationReady || report || playing || !storyTime;
  get("restart").disabled = !narrationReady || report;
  get("listen-note").textContent = report ? "В режиме отчётного чтения звук выключен." :
    narrationReady ? "" : "Запись рассказа ещё готовится.";
}

function syncModes() {
  const translated = language === "ru";
  get("language-ru").hidden = report;
  get("language-en").setAttribute("aria-pressed", String(!translated));
  get("language-ru").setAttribute("aria-pressed", String(translated));
  get("reading-controls").hidden = translated;
  get("listen-section").hidden = translated;
  document.body.classList.toggle("plain", !colors || report);
  get("colors").textContent = "Цветовые подсказки: " + (colors && !report ? "ВКЛ" : "ВЫКЛ");
  get("colors").disabled = report;
  get("colors").setAttribute("aria-pressed", String(colors && !report));
  get("lamps").disabled = !colors || report;
  get("lamps").setAttribute("aria-pressed", String(colors && lamps && !report));
  get("report").setAttribute("aria-pressed", String(report));
  get("rules").disabled = report;
  for (const lamp of lampButtons) lamp.hidden = !colors || !lamps || report;
  for (const word of wordButtons) word.disabled = report;
  if (!colors || !lamps || report) closeHint();
  syncControls();
}

function selectLanguage(next) {
  if (language === next || report) return;
  stop();
  closeHint();
  clearTimeout(statusTimer);
  get("status").hidden = true;
  language = next;
  buildStory();
  syncModes();
}

buildStory();
buildRules(rulePanel, Object.keys(edition.rules));
get("language-en").onclick = () => selectLanguage("en");
get("language-ru").onclick = () => selectLanguage("ru");

get("rules").onclick = () => {
  rulePanel.hidden = !rulePanel.hidden;
  get("rules").setAttribute("aria-expanded", String(!rulePanel.hidden));
};
get("colors").onclick = () => { colors = !colors; syncModes(); };
get("lamps").onclick = () => { lamps = !lamps; syncModes(); };
get("report").onclick = () => {
  report = !report;
  if (report) {
    stop();
    rulePanel.hidden = true;
    get("rules").setAttribute("aria-expanded", "false");
  }
  syncModes();
};
get("play").onclick = () => playAudio(narration.src, "story");
get("pause").onclick = stop;
get("resume").onclick = () => playAudio(narration.src, "story", null, storyTime);
get("restart").onclick = () => playAudio(narration.src, "story");
document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); });
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && hint) {
    const control = hint.control;
    closeHint();
    control.focus({ preventScroll: true });
  }
});
syncModes();

