// PASTE YOUR DEPLOYED VERCEL BACKEND URL HERE (no trailing slash)
const BACKEND_URL = "https://company-brief-backend.vercel.app";

const responseEl = document.getElementById("response");
const generateBtn = document.getElementById("generate-btn");
const historyBtn = document.getElementById("history-btn");
const historyOverlay = document.getElementById("history-overlay");
const historyBackdrop = document.getElementById("history-backdrop");
const historyCloseBtn = document.getElementById("history-close");
const historyListEl = document.getElementById("history-list");
const historyClearAllBtn = document.getElementById("history-clear-all");

const DEFAULT_RESPONSE_TEXT =
  "Click the button above to generate a brief of the current page.";

const RESTRICTED_PREFIXES = [
  "chrome:",
  "chrome-extension:",
  "edge:",
  "about:",
  "devtools:",
];

const LOADING_STAGES = [
  { at: 0, text: "Sending page to the agent..." },
  { at: 6000, text: "Reading the company's website..." },
  { at: 12000, text: "Researching funding, news, and team..." },
  { at: 24000, text: "Synthesizing the brief..." },
  { at: 40000, text: "Almost there — final synthesis..." },
];

const BRIEF_HISTORY_KEY = "brief_history";
const MAX_HISTORY_ENTRIES = 20;

let loadingIntervalId = null;
let lastBriefMarkdown = "";
let currentlyDisplayedUrl = null;

function isRestrictedUrl(url) {
  if (!url) return true;
  return RESTRICTED_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function cleanUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.origin + parsed.pathname;
  } catch {
    return rawUrl;
  }
}

function setResponseMessage(text, className = "status-message") {
  stopLoadingTimer();
  currentlyDisplayedUrl = null;
  responseEl.className = className;
  responseEl.textContent = text;
}

function setDefaultResponse() {
  stopLoadingTimer();
  currentlyDisplayedUrl = null;
  responseEl.className = "";
  responseEl.textContent = DEFAULT_RESPONSE_TEXT;
}

function getLoadingMessage(elapsedMs) {
  let message = LOADING_STAGES[0].text;
  for (const stage of LOADING_STAGES) {
    if (elapsedMs >= stage.at) message = stage.text;
  }
  return message;
}

function stopLoadingTimer() {
  if (loadingIntervalId !== null) {
    clearInterval(loadingIntervalId);
    loadingIntervalId = null;
  }
}

function showStagedLoading() {
  stopLoadingTimer();
  responseEl.className = "loading-state";
  responseEl.replaceChildren();

  const row = document.createElement("div");
  row.className = "loading-row";

  const spinner = document.createElement("span");
  spinner.className = "spinner";
  spinner.setAttribute("aria-hidden", "true");

  const text = document.createElement("span");
  text.className = "loading-text";
  text.id = "loading-text";

  row.append(spinner, text);
  responseEl.append(row);

  const startedAt = Date.now();
  const updateText = () => {
    text.textContent = getLoadingMessage(Date.now() - startedAt);
  };
  updateText();
  loadingIntervalId = setInterval(updateText, 500);
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function applyBold(text) {
  return escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function stripBriefPreamble(markdown) {
  const idx = markdown.indexOf("## ");
  if (idx === -1) return markdown;
  return markdown.slice(idx).trim();
}

function isSeparatorLine(line) {
  return line.trim() === "---";
}

function collapseLineBreaks(lines) {
  return lines
    .map((line) => line.trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function renderMarkdown(markdown) {
  const lines = markdown.split("\n");
  const parts = [];
  let i = 0;

  while (i < lines.length) {
    while (
      i < lines.length &&
      (lines[i].trim() === "" || isSeparatorLine(lines[i]))
    ) {
      i++;
    }
    if (i >= lines.length) break;

    if (lines[i].startsWith("## ")) {
      parts.push(`<h2>${applyBold(lines[i].slice(3).trim())}</h2>`);
      i++;
      continue;
    }

    if (lines[i].startsWith("- ")) {
      const items = [];
      while (i < lines.length) {
        if (lines[i].trim() === "" || isSeparatorLine(lines[i])) break;
        if (lines[i].startsWith("## ")) break;

        if (lines[i].startsWith("- ")) {
          const bulletLines = [lines[i].slice(2).trim()];
          i++;
          while (
            i < lines.length &&
            lines[i].trim() !== "" &&
            !isSeparatorLine(lines[i]) &&
            !lines[i].startsWith("- ") &&
            !lines[i].startsWith("## ")
          ) {
            bulletLines.push(lines[i].trim());
            i++;
          }
          items.push(collapseLineBreaks(bulletLines));
        } else if (items.length > 0) {
          items[items.length - 1] += " " + lines[i].trim();
          i++;
        } else {
          break;
        }
      }
      parts.push(
        `<ul>${items.map((item) => `<li>${applyBold(item)}</li>`).join("")}</ul>`
      );
      continue;
    }

    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !isSeparatorLine(lines[i]) &&
      !lines[i].startsWith("## ") &&
      !lines[i].startsWith("- ")
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      parts.push(`<p>${applyBold(collapseLineBreaks(paraLines))}</p>`);
    }
  }

  return parts.join("");
}

async function getBriefHistory() {
  const result = await chrome.storage.local.get(BRIEF_HISTORY_KEY);
  return result[BRIEF_HISTORY_KEY] || [];
}

async function saveBriefToHistory(url, title, brief, companyName) {
  const history = await getBriefHistory();
  const entry = {
    url,
    title,
    brief,
    company_name: companyName ?? null,
    timestamp: Date.now(),
  };
  const withoutUrl = history.filter((item) => item.url !== url);
  const updated = [entry, ...withoutUrl].slice(0, MAX_HISTORY_ENTRIES);
  await chrome.storage.local.set({ [BRIEF_HISTORY_KEY]: updated });
}

async function removeBriefForUrl(url) {
  const history = await getBriefHistory();
  const updated = history.filter((item) => item.url !== url);
  await chrome.storage.local.set({ [BRIEF_HISTORY_KEY]: updated });
  return updated;
}

async function clearAllHistory() {
  await chrome.storage.local.set({ [BRIEF_HISTORY_KEY]: [] });
}

function formatRelativeTime(timestamp) {
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  if (hours < 48) return "yesterday";
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function truncateUrlForList(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return parsed.host;
    return `${parsed.host}/${segments[0]}`;
  } catch {
    return rawUrl.length > 40 ? rawUrl.slice(0, 40) + "..." : rawUrl;
  }
}

async function updateHistoryButton() {
  const history = await getBriefHistory();
  if (history.length === 0) {
    historyBtn.hidden = true;
    return;
  }
  historyBtn.hidden = false;
  historyBtn.textContent = `History (${history.length})`;
}

function closeHistoryDropdown() {
  historyOverlay.hidden = true;
  document.removeEventListener("keydown", onHistoryEscape);
}

function onHistoryEscape(event) {
  if (event.key === "Escape") closeHistoryDropdown();
}

async function renderHistoryList() {
  const history = await getBriefHistory();
  historyListEl.replaceChildren();

  if (history.length === 0) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "No saved briefs yet.";
    historyListEl.append(empty);
    return;
  }

  for (const entry of history) {
    const item = document.createElement("div");
    item.className = "history-item";
    item.addEventListener("click", () => {
      closeHistoryDropdown();
      renderBrief(entry.brief, {
        fromHistoryList: true,
        historyTimeLabel: formatRelativeTime(entry.timestamp),
        companyName: entry.company_name,
        title: entry.title,
        url: entry.url,
      });
    });

    const main = document.createElement("div");
    main.className = "history-item-main";

    const name = document.createElement("div");
    name.className = "history-item-name";
    name.textContent = getMetadataHeading(entry.company_name, entry.title);

    const url = document.createElement("div");
    url.className = "history-item-url";
    url.textContent = truncateUrlForList(entry.url);

    const time = document.createElement("div");
    time.className = "history-item-time";
    time.textContent = formatRelativeTime(entry.timestamp);

    main.append(name, url, time);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "history-item-delete";
    deleteBtn.setAttribute("aria-label", "Delete brief");
    deleteBtn.textContent = "✕";
    deleteBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      await removeBriefForUrl(entry.url);
      if (cleanUrl(entry.url) === currentlyDisplayedUrl) {
        setDefaultResponse();
      }
      await renderHistoryList();
      await updateHistoryButton();
    });

    item.append(main, deleteBtn);
    historyListEl.append(item);
  }
}

async function openHistoryDropdown() {
  await renderHistoryList();
  historyOverlay.hidden = false;
  document.addEventListener("keydown", onHistoryEscape);
}

function getMetadataHeading(companyName, pageTitle) {
  const name =
    (companyName && String(companyName).trim()) ||
    (pageTitle && String(pageTitle).trim());
  return name || "(No title)";
}

function createMetadataHeader(heading, url) {
  const header = document.createElement("div");
  header.style.marginBottom = "14px";
  header.style.paddingBottom = "14px";
  header.style.borderBottom = "1px solid #e2e6ec";

  const titleEl = document.createElement("h3");
  titleEl.textContent = heading;
  titleEl.style.fontSize = "15px";
  titleEl.style.fontWeight = "600";
  titleEl.style.color = "#1a1a2e";
  titleEl.style.lineHeight = "1.35";
  titleEl.style.marginBottom = "4px";

  const urlEl = document.createElement("p");
  urlEl.textContent = cleanUrl(url || "");
  urlEl.style.fontSize = "12px";
  urlEl.style.color = "#8b919a";
  urlEl.style.wordBreak = "break-all";
  urlEl.style.lineHeight = "1.4";

  header.append(titleEl, urlEl);
  return header;
}

function createCopyButton() {
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "copy-btn";
  copyBtn.textContent = "Copy brief";
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(lastBriefMarkdown);
      copyBtn.textContent = "Copied ✓";
      setTimeout(() => {
        copyBtn.textContent = "Copy brief";
      }, 2000);
    } catch {
      copyBtn.textContent = "Copy failed";
      setTimeout(() => {
        copyBtn.textContent = "Copy brief";
      }, 2000);
    }
  });
  return copyBtn;
}

function renderBrief(
  markdown,
  {
    fromCache = false,
    fromHistoryList = false,
    historyTimeLabel = "",
    pageUrl = null,
    companyName = null,
    title = "",
    url = "",
  } = {}
) {
  stopLoadingTimer();
  const cleaned = stripBriefPreamble(markdown);
  lastBriefMarkdown = cleaned;
  currentlyDisplayedUrl = url ? cleanUrl(url) : null;

  responseEl.className = "brief-content";
  responseEl.replaceChildren();

  const children = [];

  if (fromHistoryList && historyTimeLabel) {
    const note = document.createElement("p");
    note.style.fontSize = "12px";
    note.style.color = "#5c6370";
    note.style.marginBottom = "12px";
    note.style.lineHeight = "1.45";
    note.textContent = `Viewing a saved brief from ${historyTimeLabel}. Click Generate to brief the current page instead.`;
    children.push(note);
  } else if (fromCache && pageUrl) {
    const note = document.createElement("p");
    note.style.fontSize = "12px";
    note.style.color = "#5c6370";
    note.style.marginBottom = "12px";
    note.style.lineHeight = "1.45";
    note.append("Showing the brief generated earlier for this page ");

    const regenerateBtn = document.createElement("button");
    regenerateBtn.type = "button";
    regenerateBtn.textContent = "Regenerate";
    regenerateBtn.style.cssText =
      "background:none;border:none;padding:0;color:#2c4a6e;cursor:pointer;font:inherit;font-size:12px;font-weight:500;text-decoration:underline;width:auto;";
    regenerateBtn.addEventListener("click", async () => {
      await removeBriefForUrl(pageUrl);
      runGeneration();
    });
    note.append(regenerateBtn);
    children.push(note);
  }

  children.push(
    createMetadataHeader(getMetadataHeading(companyName, title), url)
  );

  const briefBody = document.createElement("div");
  briefBody.className = "brief-body";
  briefBody.innerHTML = renderMarkdown(cleaned);
  children.push(briefBody, createCopyButton());

  responseEl.append(...children);
}

function extractPageContent() {
  const MAX_BODY = 12000;
  const MAX_LINKS = 40;

  let bodyText = document.body ? document.body.innerText : "";
  if (bodyText.length > MAX_BODY) {
    bodyText = bodyText.slice(0, MAX_BODY);
  }

  function isMeaningfulText(text) {
    const trimmed = text.trim();
    if (!trimmed) return false;
    return /[a-zA-Z0-9]/.test(trimmed);
  }

  function isInternalHref(href) {
    try {
      const linkUrl = new URL(href, window.location.href);
      return linkUrl.origin === window.location.origin;
    } catch {
      return false;
    }
  }

  const seen = new Set();
  const links = [];

  for (const anchor of document.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (!href || !isInternalHref(href)) continue;

    const text = (anchor.innerText || anchor.textContent || "").trim();
    if (!isMeaningfulText(text)) continue;

    let absoluteHref;
    try {
      absoluteHref = new URL(href, window.location.href).href;
    } catch {
      continue;
    }

    const key = absoluteHref + "|" + text;
    if (seen.has(key)) continue;
    seen.add(key);

    links.push({ text, href: absoluteHref });
    if (links.length >= MAX_LINKS) break;
  }

  return {
    url: window.location.href,
    title: document.title,
    bodyText,
    links,
  };
}

async function parseErrorMessage(response) {
  try {
    const data = await response.json();
    if (typeof data === "string") return data;
    return data.error || data.message || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

async function fetchBrief(pageData) {
  let response;
  try {
    response = await fetch(`${BACKEND_URL}/api/brief`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pageData),
    });
  } catch {
    throw new Error("NETWORK");
  }

  if (!response.ok) {
    const message = await parseErrorMessage(response);
    throw new Error(message);
  }

  const data = await response.json();
  if (!data?.brief) {
    throw new Error("Invalid response from brief service.");
  }

  return { brief: data.brief, company_name: data.company_name ?? null };
}

async function runGeneration() {
  setResponseMessage("Reading page...");
  generateBtn.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab?.id || isRestrictedUrl(tab.url)) {
      setResponseMessage(
        "Can't read this page (browser-restricted)",
        "error-message"
      );
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageContent,
    });

    const pageData = results?.[0]?.result;
    if (!pageData) {
      setResponseMessage(
        "Can't read this page (browser-restricted)",
        "error-message"
      );
      return;
    }

    showStagedLoading();
    const { brief, company_name } = await fetchBrief(pageData);
    const cleaned = stripBriefPreamble(brief);
    const pageUrl = cleanUrl(pageData.url);
    await saveBriefToHistory(
      pageUrl,
      pageData.title,
      cleaned,
      company_name
    );
    renderBrief(cleaned, {
      companyName: company_name,
      title: pageData.title,
      url: pageUrl,
    });
    await updateHistoryButton();
  } catch (err) {
    if (err.message === "NETWORK") {
      setResponseMessage(
        "Couldn't reach the brief service. Check your connection and try again.",
        "error-message"
      );
    } else {
      setResponseMessage(err.message, "error-message");
    }
  } finally {
    stopLoadingTimer();
    generateBtn.disabled = false;
  }
}

async function restoreCachedBriefIfAny() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab?.url || isRestrictedUrl(tab.url)) return;

    const pageUrl = cleanUrl(tab.url);
    const history = await getBriefHistory();
    const cached = history.find((item) => cleanUrl(item.url) === pageUrl);
    if (cached) {
      renderBrief(cached.brief, {
        fromCache: true,
        pageUrl: cached.url,
        companyName: cached.company_name,
        title: cached.title,
        url: cached.url,
      });
    }
  } catch {
    // Keep default placeholder on failure
  }
}

generateBtn.addEventListener("click", runGeneration);

historyBtn.addEventListener("click", openHistoryDropdown);
historyBackdrop.addEventListener("click", closeHistoryDropdown);
historyCloseBtn.addEventListener("click", closeHistoryDropdown);
historyClearAllBtn.addEventListener("click", async () => {
  await clearAllHistory();
  setDefaultResponse();
  closeHistoryDropdown();
  await updateHistoryButton();
});

updateHistoryButton();
restoreCachedBriefIfAny();
