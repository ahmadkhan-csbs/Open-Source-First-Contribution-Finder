# OpenStart

OpenStart helps new contributors find approachable, open GitHub issues and know how to begin. Search by topic, language, or `owner/repository`; results are ranked using issue labels and descriptions, plus recent repository activity when GitHub's public API provides it.

## Run locally

This is a static app with no build step or dependencies. Open `index.html` in a browser, or serve the repository with any static file server.

## Publish on GitHub Pages

The GitHub Actions workflow in `.github/workflows/deploy-pages.yml` deploys the static site whenever changes are pushed to the `potfolio-webside` branch. Merge the site and workflow into that branch to start the first deployment. In the repository, open **Settings → Pages** and confirm **Build and deployment → Source** is set to **GitHub Actions**. The first successful `Deploy OpenStart to GitHub Pages` workflow run publishes the site at:

<https://ahmadkhan-csbs.github.io/Open-Source-First-Contribution-Finder/>

## How the score works

Each issue receives a transparent score out of 100:

- 30 points for a maintainer-applied beginner-friendly label such as `good first issue`.
- 8 points for a `help wanted` label, which is useful but does not by itself mean an issue is beginner-friendly.
- Up to 25 points for a detailed issue description and a specific, actionable task.
- Up to 7 points for recent repository activity.
- Points are deducted for signals that may make an issue harder for a first contribution, such as broad rewrites, large-scope labels, migrations, or unusually long descriptions.

Scores of 80 or more are marked “Good first step”; 55–79 are “Worth a look”; lower scores are shown as “Explore.” The score is a guide, not a guarantee. Always read the issue, repository contribution guide, and recent discussion before starting work.

## GitHub API

OpenStart uses GitHub's public REST API without authentication. GitHub applies unauthenticated rate limits, so searches may be temporarily unavailable if the limit is reached.
