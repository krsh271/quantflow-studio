QUANTFLOW BACKTESTING STUDIO — HISTORICAL NEWS SCAN

Deploy all files in this ZIP as a Netlify site via a Git-connected deployment or
Netlify CLI build/deploy. The site contains a serverless function using cheerio
and will need dependency installation by Netlify during build.

IMPORTANT: Manual drag-and-drop ZIP deployment typically does not build
and install dependencies for Netlify Functions. For live scans, deploy using
Git/Netlify CLI, or use Netlify's build process. If the site is opened as a
local HTML file, the historical scan cannot run; the calendar CSV/JSON import
is available instead.

News data source: Forex Factory historical weekly calendar pages.
Automatic retrieval depends on their HTML and anti-bot availability. If retrieval
fails, the site will retain previous exclusions and show an error rather than
claim that no red events occurred. Calendar dates are matched to NT8 entry dates,
so users must check session time zones.
