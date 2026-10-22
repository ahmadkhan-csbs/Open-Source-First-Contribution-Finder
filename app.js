const API_ROOT = "https://api.github.com";
const BEGINNER_LABELS = [
  "good first issue",
  "beginner",
  "first timers only",
  "first-timers-only",
  "easy",
  "up-for-grabs",
];
const POSITIVE_SIGNALS = [
  "documentation",
  "steps to reproduce",
  "expected behavior",
  "acceptance criteria",
  "screenshot",
  "contributing",
];
const COMPLEXITY_SIGNALS = [
  "rewrite",
  "migration",
  "refactor",
  "architecture",
  "breaking change",
  "performance overhaul",
];

const form = document.querySelector("#search-form");
const searchInput = document.querySelector("#search-input");
const clearSearch = document.querySelector("#clear-search");
const searchButton = document.querySelector("#search-button");
const sortSelect = document.querySelector("#sort-select");
const issueList = document.querySelector("#issue-list");
const resultsCount = document.querySelector("#results-count");
const statusMessage = document.querySelector("#status-message");
const welcomeGrid = document.querySelector("#welcome-grid");

let currentIssues = [];
let searchSequence = 0;

form.addEventListener("submit", (event) => {
  event.preventDefault();
  searchIssues(searchInput.value);
});

searchInput.addEventListener("input", () => {
  clearSearch.hidden = searchInput.value.length === 0;
});

clearSearch.addEventListener("click", () => {
  searchInput.value = "";
  clearSearch.hidden = true;
  searchInput.focus();
});

document.querySelectorAll(".search-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    searchInput.value = chip.dataset.query;
    clearSearch.hidden = false;
    searchIssues(chip.dataset.query);
  });
});

sortSelect.addEventListener("change", () => {
  renderIssues();
});

issueList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='details']");
  if (!button) return;

  const details = document.querySelector(`#${button.getAttribute("aria-controls")}`);
  const isExpanded = button.getAttribute("aria-expanded") === "true";
  button.setAttribute("aria-expanded", String(!isExpanded));
  button.textContent = isExpanded ? "Start here ↓" : "Hide steps ↑";
  details.hidden = isExpanded;
});

async function searchIssues(rawQuery) {
  const query = rawQuery.trim();
  if (!query) {
    searchInput.focus();
    return;
  }

  const sequence = ++searchSequence;
  searchButton.disabled = true;
  searchButton.innerHTML = "Finding issues <span aria-hidden=\"true\">…</span>";
  statusMessage.hidden = true;
  issueList.replaceChildren();
  welcomeGrid.hidden = true;
  resultsCount.textContent = `Searching GitHub for “${query}”…`;

  try {
    const { keywordQuery, beginnerQuery, isRepository } = buildGithubQueries(query);
    const [data, beginnerData] = await Promise.all([
      fetchIssueSearch(keywordQuery, isRepository),
      fetchIssueSearch(beginnerQuery),
    ]);
    const issueById = new Map();
    [...(data.items || []), ...(beginnerData.items || [])].forEach((issue) => {
      if (!issue.pull_request) issueById.set(issue.id, issue);
    });
    const issues = [...issueById.values()];
    const { activity: repoActivity, checked: checkedRepositories } = await loadRepositoryActivity(issues);
    if (sequence !== searchSequence) return;

    currentIssues = issues.map((issue) => {
      const repo = repoName(issue.repository_url);
      return {
        issue,
        repo,
        activityChecked: checkedRepositories.has(repo),
        ...scoreIssue(issue, repoActivity.get(repo)),
      };
    }).sort((a, b) => b.score - a.score).slice(0, 30);

    const matchCount = Number(data.total_count || 0);
    resultsCount.textContent = `${matchCount.toLocaleString()} open issue${matchCount === 1 ? "" : "s"} found · showing up to ${currentIssues.length} ranked by first-contribution fit`;

    if (!currentIssues.length) {
      showMessage(`No open issues found for “${query}”. Try a broader topic, a programming language, or an owner/repository name.`);
    }
    renderIssues();
  } catch (error) {
    if (sequence !== searchSequence) return;
    currentIssues = [];
    resultsCount.textContent = "We couldn’t complete that search";
    showMessage(error.message);
    welcomeGrid.hidden = true;
  } finally {
    if (sequence === searchSequence) {
      searchButton.disabled = false;
      searchButton.innerHTML = "Find my first issue <span aria-hidden=\"true\">→</span>";
    }
  }
}

function buildGithubQueries(query) {
  const safeTerm = query.replace(/"/g, "").replace(/\s+/g, " ");
  const isRepository = /^[\w.-]+\/[\w.-]+$/.test(safeTerm);
  const keywordQuery = isRepository
    ? `repo:${safeTerm} is:issue is:open`
    : `"${safeTerm}" is:issue is:open`;
  const beginnerQuery = `${keywordQuery} label:"good first issue"`;
  return { keywordQuery, beginnerQuery, isRepository };
}

async function fetchIssueSearch(query, sortByUpdated = false) {
  const url = new URL(`${API_ROOT}/search/issues`);
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", "30");
  if (sortByUpdated) {
    url.searchParams.set("sort", "updated");
    url.searchParams.set("order", "desc");
  }

  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) {
    throw new Error(await getApiError(response));
  }
  return response.json();
}

async function getApiError(response) {
  if (response.status === 403 || response.status === 429) {
    return "GitHub’s public API rate limit has been reached. Please wait a little while and try again.";
  }

  let message = `GitHub returned an error (${response.status}). Please try again.`;
  try {
    const body = await response.json();
    if (body.message) message = body.message;
  } catch {
    // The status-based message remains useful when GitHub does not return JSON.
  }
  return message;
}

async function loadRepositoryActivity(issues) {
  const repositories = [...new Set(
    [...issues]
      .sort((a, b) => scoreIssue(b, null).score - scoreIssue(a, null).score)
      .map((issue) => repoName(issue.repository_url)),
  )].slice(0, 8);
  const activity = new Map();
  const checked = new Set(repositories);
  let nextRepository = 0;

  async function worker() {
    while (nextRepository < repositories.length) {
      const repository = repositories[nextRepository++];
      try {
        const response = await fetch(`${API_ROOT}/repos/${repository}`, {
          headers: { Accept: "application/vnd.github+json" },
        });
        if (!response.ok) continue;
        const data = await response.json();
        activity.set(repository, {
          updatedAt: data.updated_at,
          language: data.language,
          stars: data.stargazers_count,
        });
      } catch {
        // Repository metadata is optional; issue ranking still works without it.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(4, repositories.length) }, worker));
  return { activity, checked };
}

function scoreIssue(issue, repository) {
  const labels = issue.labels.map((label) => label.name.toLowerCase());
  const body = (issue.body || "").toLowerCase();
  const title = issue.title.toLowerCase();
  const text = `${title} ${body}`;
  let score = 38;
  const reasons = [];

  const beginnerLabel = labels.find((label) => BEGINNER_LABELS.includes(label));
  if (beginnerLabel) {
    score += 30;
    reasons.push(`Tagged “${beginnerLabel}” by maintainers`);
  } else if (labels.includes("help wanted")) {
    score += 8;
    reasons.push("Maintainers have asked for community help");
  }

  if (body.length >= 80 && body.length <= 2400) {
    score += 10;
    reasons.push("Issue has enough detail to understand the task");
  } else if (body.length > 5000) {
    score -= 8;
    reasons.push("Long description may take extra time to unpack");
  }

  const positiveSignal = POSITIVE_SIGNALS.find((signal) => text.includes(signal));
  if (positiveSignal) {
    score += 10;
    reasons.push(`Description includes a useful ${positiveSignal} signal`);
  }

  if (/\b(add|fix|update|improve|document|support)\b/i.test(title)) {
    score += 5;
    reasons.push("Title suggests a specific, actionable task");
  }

  const complexitySignal = COMPLEXITY_SIGNALS.find((signal) => text.includes(signal));
  if (complexitySignal) {
    score -= 18;
    reasons.push(`“${complexitySignal}” may indicate a broader task`);
  }

  const largeScopeLabel = labels.find((label) => /^(?:size:)?(?:l|xl|xxl|large|very large)$/.test(label));
  if (largeScopeLabel || /\b(?:series of prs|multiple components|comprehensive overhaul|end-to-end rewrite)\b/.test(text)) {
    score -= 18;
    reasons.push("Task may cover too much scope for a first contribution");
  }

  if (repository?.updatedAt) {
    const daysSinceUpdate = (Date.now() - Date.parse(repository.updatedAt)) / 86_400_000;
    if (daysSinceUpdate < 30) {
      score += 7;
      reasons.push("Repository has recent activity");
    } else if (daysSinceUpdate < 180) {
      score += 3;
      reasons.push("Repository has activity in the past six months");
    }
  }

  if (!reasons.length) reasons.push("Open issue with room to assess the scope");
  return {
    score: Math.max(10, Math.min(100, score)),
    reasons: reasons.slice(0, 3),
    language: repository?.language || "",
    stars: repository?.stars,
  };
}

function repoName(repositoryUrl) {
  return repositoryUrl.replace(`${API_ROOT}/repos/`, "");
}

function renderIssues() {
  const sort = sortSelect.value;
  const issues = [...currentIssues];
  if (sort === "updated") {
    issues.sort((a, b) => Date.parse(b.issue.updated_at) - Date.parse(a.issue.updated_at));
  } else if (sort === "comments") {
    issues.sort((a, b) => a.issue.comments - b.issue.comments);
  } else {
    issues.sort((a, b) => b.score - a.score);
  }

  issueList.replaceChildren(...issues.map(renderIssue));
}

function renderIssue(result) {
  const { issue, repo, score, reasons, language, stars } = result;
  const card = document.createElement("article");
  card.className = "issue-card";

  const top = document.createElement("div");
  top.className = "issue-topline";
  const repoLink = document.createElement("a");
  repoLink.className = "repo-link";
  repoLink.href = `https://github.com/${repo}`;
  repoLink.target = "_blank";
  repoLink.rel = "noreferrer";
  repoLink.innerHTML = `<span class="repo-mark" aria-hidden="true">◈</span> ${escapeHtml(repo)}`;
  const scoreBadge = document.createElement("span");
  scoreBadge.className = `score ${score < 50 ? "explore" : score < 55 ? "moderate" : ""}`;
  scoreBadge.textContent = `${score} / 100 · ${score >= 80 ? "Good first step" : score >= 55 ? "Worth a look" : "Explore"}`;
  top.append(repoLink, scoreBadge);

  const title = document.createElement("a");
  title.className = "issue-title";
  title.href = issue.html_url;
  title.target = "_blank";
  title.rel = "noreferrer";
  title.textContent = issue.title;
  const number = document.createElement("span");
  number.className = "issue-number";
  number.textContent = ` · #${issue.number}`;

  const description = document.createElement("p");
  description.className = "issue-description";
  description.textContent = summarize(issue.body || "No description has been added yet.");

  const tags = document.createElement("div");
  tags.className = "issue-tags";
  if (language) tags.append(createTag(language));
  issue.labels.slice(0, 4).forEach((label) => {
    const tag = createTag(label.name);
    if (BEGINNER_LABELS.includes(label.name.toLowerCase())) tag.classList.add("beginner-tag");
    tags.append(tag);
  });

  const footer = document.createElement("div");
  footer.className = "issue-footer";
  const stats = document.createElement("div");
  stats.className = "issue-stats";
  stats.append(
    createStat("◷", `Updated ${formatAge(issue.updated_at)}`),
    createStat("◌", `${issue.comments} comments`),
  );
  if (typeof stars === "number") stats.append(createStat("★", stars.toLocaleString()));

  const actions = document.createElement("div");
  actions.className = "issue-actions";
  const detailsId = `issue-details-${issue.id}`;
  const detailsButton = document.createElement("button");
  detailsButton.className = "details-button";
  detailsButton.type = "button";
  detailsButton.dataset.action = "details";
  detailsButton.setAttribute("aria-expanded", "false");
  detailsButton.setAttribute("aria-controls", detailsId);
  detailsButton.textContent = "Start here ↓";
  const openIssue = document.createElement("a");
  openIssue.className = "issue-action";
  openIssue.href = issue.html_url;
  openIssue.target = "_blank";
  openIssue.rel = "noreferrer";
  openIssue.textContent = "View issue ↗";
  actions.append(detailsButton, openIssue);
  footer.append(stats, actions);

  const details = document.createElement("div");
  details.className = "issue-details";
  details.id = detailsId;
  details.hidden = true;
  const detailsTitle = document.createElement("h3");
  detailsTitle.textContent = "Your first steps";
  const steps = document.createElement("ul");
  const paths = findFilePaths(issue.body || "");
  const stepTexts = [
    `Read the issue and its latest comments to confirm the expected outcome.`,
    paths.length
      ? `Start by looking at ${paths.join(", ")} in the repository.`
      : `Browse the repository for files related to “${issue.title}”.`,
    `Look for a CONTRIBUTING.md file, a README contribution section, or a setup guide. Then comment with your plan before opening a pull request.`,
  ];
  reasons.forEach((reason) => stepTexts.push(`Why it may suit a first contribution: ${reason}.`));
  stepTexts.forEach((text) => {
    const step = document.createElement("li");
    step.textContent = text;
    steps.append(step);
  });
  details.append(detailsTitle, steps);
  if (!result.language && stars === undefined) {
    const activity = document.createElement("p");
    activity.className = "repo-activity";
    activity.textContent = result.activityChecked
      ? "Repository activity could not be loaded; this score uses issue signals only."
      : "Repository activity was not checked for every result; this score uses issue signals only.";
    details.append(activity);
  }

  card.append(top, title, number, description, tags, footer, details);
  return card;
}

function createTag(text) {
  const tag = document.createElement("span");
  tag.className = "issue-tag";
  tag.textContent = text;
  return tag;
}

function createStat(icon, text) {
  const stat = document.createElement("span");
  const iconNode = document.createElement("span");
  iconNode.setAttribute("aria-hidden", "true");
  iconNode.textContent = icon;
  stat.append(iconNode, document.createTextNode(text));
  return stat;
}

function findFilePaths(body) {
  return [...new Set((body.match(/(?:^|\s)(?:[\w.-]+\/)*[\w.-]+\.(?:js|jsx|ts|tsx|py|go|rs|md|css|html|json)\b/g) || [])
    .map((path) => path.trim())
    .slice(0, 2))];
}

function summarize(text) {
  const plain = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/[#>*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > 240 ? `${plain.slice(0, 237).trimEnd()}…` : plain;
}

function formatAge(dateString) {
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(dateString)) / 86_400_000));
  if (days < 1) return "today";
  if (days === 1) return "1 day";
  if (days < 30) return `${days} days`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month" : `${months} months`;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function showMessage(message) {
  statusMessage.textContent = message;
  statusMessage.hidden = false;
}
