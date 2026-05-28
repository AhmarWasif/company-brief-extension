# Company Brief — a Chrome extension powered by an AI research agent

Open any company's website. Click the extension. Watch an AI agent autonomously
read the site, fetch its key pages, search the web for funding and recent news,
and produce a structured analyst-grade brief — usually in 20–40 seconds.

I built this to research the companies I was applying to. The recursion is the
point: this is the tool that helped me prepare for the interviews where I'd
talk about building it.

## What's actually happening

Most "AI-powered" Chrome extensions wrap a single LLM call in a popup. This one
is structurally different: it's a **multi-step agent** that decides for itself
what to research.

When you click "Generate brief":

1. The extension extracts the current page's title, body text, and internal navigation links.
2. It sends that payload to a serverless backend.
3. The backend calls Claude with the `web_search` and `web_fetch` tools enabled.
4. **Claude reasons about what's missing** from the page and independently:
   - Fetches relevant internal pages (`/about`, `/product`, `/careers`, etc.)
   - Searches the web for current funding rounds, leadership signals, recent news
   - Fetches the specific article URLs those searches return
5. After several rounds of research, Claude synthesizes everything into a brief
   with five sections: what they do, funding signal, market thesis, likely
   operating pains, and smart questions to ask in an interview.

The agent decides *its own* research plan based on what the page contains. A
funding-heavy company homepage might trigger only one web search; a thin landing
page might trigger five fetches and three searches. That decision-making is
the agentic part — and it's what makes this different from a chat-with-document
tool.

## Architecture

```
Chrome Extension                  Vercel Serverless Backend           Anthropic API
─────────────────                ─────────────────────────             ─────────────
Popup UI                          POST /api/brief                      Claude w/ tools:
Page extraction (activeTab) ──▶   System framing               ──▶     • web_search
Sends url, title, body, links     Web tools enabled                    • web_fetch
                                                                       Autonomous
                                                                       agentic loop
                                  Returns Markdown brief       ◀──     Synthesized
Renders structured brief    ◀──                                        output
```

Key design decisions worth calling out:

- **Minimum-viable permissions.** The manifest only requests `activeTab` and
  `scripting`. The extension can read only the page you explicitly invoke it on,
  and only at that moment. No `<all_urls>`, no browsing history, no background
  activity. Most extensions over-request permissions; this one is scoped to
  exactly what it needs.
- **API key never reaches the client.** The `ANTHROPIC_API_KEY` lives as a
  Vercel environment variable on the backend. The extension knows nothing about
  it. Same pattern as the rest of my projects.
- **Claude can only fetch URLs already in context.** A built-in security feature
  of Anthropic's `web_fetch` tool: the agent can't hallucinate URLs and fetch
  them — only follow links from the page itself or from search results already
  returned. This significantly bounds the abuse surface.
- **Honest loading UX.** A 20–40 second wait would feel broken with a static
  "Loading…" indicator. The popup cycles through stage messages ("Reading the
  website…" → "Researching funding and news…" → "Synthesizing…") so the
  perceived experience matches what's actually happening behind the scenes.

## Try it yourself

This extension is loaded in Chrome's developer mode, not published to the Chrome
Web Store. Two-part setup:

**1. Deploy the backend.** Clone the companion backend repo at
[company-brief-backend](https://github.com/AhmarWasif/company-brief-backend),
deploy it to Vercel, and set an `ANTHROPIC_API_KEY` environment variable in the
Vercel project settings. Get an API key at
[console.anthropic.com](https://console.anthropic.com).

**2. Configure the extension.** Clone this repo, open `popup.js`, and replace
the `BACKEND_URL` constant near the top with your deployed Vercel URL (no
trailing slash).

**3. Load it in Chrome.** Go to `chrome://extensions/`, toggle Developer mode
on (top right), click "Load unpacked," and select this folder. Pin the extension
to your toolbar.

Now click the extension on any company's website and watch the agent research.

## What this project taught me

- **Agentic AI is a different category from single-call LLM apps.** Designing
  for an autonomous decision-loop requires different mental models around
  latency, tool design, and honest UX during long operations. The work isn't
  prompt engineering; it's giving the model the right tools, framing, and
  constraints so the loop terminates with something useful.
- **Permissions design is itself a feature.** The narrowest permission that
  supported the use case (`activeTab`) shaped everything downstream — and turned
  out to be a stronger signal of design care than any single feature.
- **Long operations need designed-for-wait UX.** Honest, evolving status text
  during the 20–40 second wait is the difference between "is this broken?" and
  "I can see it working." Same principle as a thoughtful loading state on a
  data dashboard, but more important when the wait is real.
- **Build the tool that solves your own problem.** I built this for my own job
  search. The specificity made the requirements obvious; the authenticity made
  it easy to keep iterating.

## Honest scope

- Brief quality depends on the source page. Content-rich company sites yield
  rich briefs; thin "request a demo" pages yield sparser ones.
- The agent can't access paywalled sources like Crunchbase or PitchBook.
  Funding signal is pulled from press coverage, news search, and the company's
  own communications.
- For very small or obscure companies, even web search may return thin signal.
  The brief surfaces that honestly ("Not found in available sources") rather
  than fabricating numbers.

## Roadmap

- [x] Agentic flow with `web_search` + `web_fetch`
- [x] Multi-step autonomous research, visible reasoning
- [x] Minimum-viable permissions
- [x] Markdown rendering in popup with copy-to-clipboard
- [x] Save briefs to a local archive across sessions
- [ ] One-click "draft outreach message" using the brief as context
- [ ] Export brief as Markdown or PDF
