# Changesets

This folder contains release notes for changes that have not been versioned
yet. Run `pnpm changeset`, select the appropriate semantic-version bump, and
commit the generated Markdown file with the change.

The release workflow collects these files into a Version Packages pull request
that updates `package.json` and `CHANGELOG.md`.
