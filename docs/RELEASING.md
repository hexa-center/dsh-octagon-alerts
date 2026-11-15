# Releasing

Distribution goes through GitHub only — no npm account or npmjs access is needed.
The market installs, in order: an npm package (none here), a tarball attached to a
GitHub Release, or the repository source. The last two need nothing but a public repo.

## 1. Push the repository

```sh
gh repo create dsh-octagon-alerts --public --source=. --push --remote=origin
gh repo edit --add-topic dsh-plugin
```

If the repository already exists, `git remote set-url origin https://github.com/hexa-center/dsh-octagon-alerts.git`
and `git push -u origin main` instead. Needs `gh` logged in, or an SSH key added to
GitHub (`ssh -T git@github.com` must succeed).

## 2. Build the tarball

```sh
npm pack --cache /tmp/npm-cache-hexa
cp dsh-octagon-alerts-<version>.tgz /tmp/dsh-octagon-alerts.tgz
```

`npm pack` runs fully offline. The cache flag avoids a permission error in a
root-owned `~/.npm/_cacache`. Keep the uploaded asset name free of the version so the
stable `latest/download` URL keeps working across releases; `*.tgz` is gitignored.

## 3. Create the release

```sh
gh release create v<version> /tmp/dsh-octagon-alerts.tgz \
  --title "v<version>" \
  --notes-file ~/Downloads/dsh-octagon-alerts-release-notes-v0.1.0.md
```

The install URL becomes
`https://github.com/hexa-center/dsh-octagon-alerts/releases/latest/download/dsh-octagon-alerts.tgz`.

## 4. Submit to the catalog

The market only installs what the curated registry lists. Add exactly one file,
`data/plugins/hexa-center__dsh-octagon-alerts.yml`, to a fork of
`awesome-dsh-plugin/awesome-dsh-plugin` and open a pull request (at most three
entries per PR, repository at least one day old, `dsh-plugin` topic set):

```yaml
url: https://github.com/hexa-center/dsh-octagon-alerts
name: hexa-center/dsh-octagon-alerts
category: notify
description:
  en: 'Plays a synthesized chime when a Session needs a choice, needs approval, or finishes while you are away, with a pickable chime for each moment.'
  zh: '会话需要你选择、需要你授权，或你不在看时任务完成，就播放合成提示音；三种时机可各选一种音效。'
tarball: https://github.com/hexa-center/dsh-octagon-alerts/releases/latest/download/dsh-octagon-alerts.tgz
```

Order matters: the release from step 3 must exist before the pull request is opened,
because the tarball URL has to resolve. CI then reads `dsh.bundle` from the repository
manifest, checks the repository age and builds the site. The site and the market pick
the entry up within about a day.

## 5. Next version

Bump `version` in `package.json`, commit, tag `v<version>`, repeat steps 2–3. A release
whose asset name carries the version must be referenced with a pinned tag URL instead
of `latest/download`.
