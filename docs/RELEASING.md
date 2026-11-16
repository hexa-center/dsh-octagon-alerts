# Releasing

The package ships three ways, and the market tries them in this order: an npm
package, a tarball attached to a GitHub Release, then the repository source. npm is
the shortest install command and the only path served by a registry CDN; the GitHub
paths need nothing but a public repository and stay as the fallback.

The published name is **`@octagon-teams/dsh-octagon-alerts`** (scoped, because the
account's publish token is limited to the `@octagon-teams` scope). `package.json` and
`cordis.patch.yml` must both carry that name.

## 1. Publish to npm

Publishing must go to <https://registry.npmjs.org> explicitly — the machine's default
registry is a read-only mirror, and `npm publish` against it fails.

```sh
npm version <patch|minor|major> --no-git-tag-version
npm publish --registry https://registry.npmjs.org
```

This account has 2FA in `auth-and-writes` mode, so npm answers `E_STAGE_REQUIRED`:
the credential is a scope-scoped token that may only write to the staging area, and a
human must approve. Use npm 11 for the two staging commands (npm 10 has neither):

```sh
npx npm@11 stage publish   --registry https://registry.npmjs.org
npx npm@11 stage approve <stage-id> --auth-type=web --registry https://registry.npmjs.org
```

`stage publish` prints the `<stage-id>` (a UUID). `stage approve` opens a
`https://www.npmjs.com/auth/cli/…` link; confirm it in the browser with the account's
passkey and the version goes live. Verify with:

```sh
curl -s https://registry.npmjs.org/@octagon-teams%2fdsh-octagon-alerts | head -c 400
```

To drop the two-step dance, bind an authenticator once with
`npm profile enable-2fa auth-only --registry https://registry.npmjs.org` and publish
with `--otp <code>`; `npm publish` then works directly.

Note that `npm pack` runs offline with `--cache /tmp/npm-cache-hexa` when `~/.npm` is
not writable.

## 2. Push the repository

```sh
gh repo create dsh-octagon-alerts --public --source=. --push --remote=origin
gh repo edit --add-topic dsh-plugin
```

If the repository already exists, `git remote set-url origin https://github.com/hexa-center/dsh-octagon-alerts.git`
and `git push -u origin main` instead. Needs `gh` logged in, or an SSH key added to
GitHub (`ssh -T git@github.com` must succeed).

## 3. Build the release tarball

```sh
npm pack --cache /tmp/npm-cache-hexa
cp octagon-teams-dsh-octagon-alerts-<version>.tgz dsh-octagon-alerts.tgz
```

Keep the uploaded asset name free of the version so the stable `latest/download` URL
keeps working across releases; `*.tgz` is gitignored.

## 4. Create the release

```sh
gh release create v<version> dsh-octagon-alerts.tgz \
  --title "v<version>" \
  --notes-file ~/Downloads/dsh-octagon-alerts-release-notes-v0.1.0.md
```

The install URL becomes
`https://github.com/hexa-center/dsh-octagon-alerts/releases/latest/download/dsh-octagon-alerts.tgz`.
The catalog entry points at it, so this URL must resolve before the pull request is
opened.

## 5. Submit to the catalog

The market only installs what the curated registry lists. Add exactly one file,
`data/plugins/hexa-center__dsh-octagon-alerts.yml`, to a fork of
`awesome-dsh-plugin/awesome-dsh-plugin` and open a pull request (at most three
entries per PR, repository at least one day old, `dsh-plugin` topic set):

```yaml
url: https://github.com/hexa-center/dsh-octagon-alerts
name: hexa-center/dsh-octagon-alerts
category: notify
description:
  en: 'Plays a synthesized chime when a Session needs a choice, needs approval, or finishes while you are away, with a pickable chime and per-moment volume for each moment.'
  zh: '会话需要你选择、需要你授权，或你不在看时任务完成，就播放合成提示音；三种时机可各选一种音效并单独调整音量。'
tarball: https://github.com/hexa-center/dsh-octagon-alerts/releases/latest/download/dsh-octagon-alerts.tgz
```

The entry only lists the GitHub URL; the `npm:` field is not written by hand (the site
collects it) and CI reads `dsh.bundle` from the repository manifest, checks the
repository age, and builds the site. The site and the market pick the entry up within
about a day.

## 6. Next version

Bump `version` in `package.json`, commit, repeat step 1 for npm, then steps 3–4 for
the tarball. A release whose asset name carries the version must be referenced with a
pinned tag URL instead of `latest/download`.
