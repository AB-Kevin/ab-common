# ab-common

The parts every Anabaptist Brotherhood app needs, kept in one place instead of copied into each app. Each app installs it by tag, and electron-builder bundles it into the app's installer, so it never appears in AB Apps and changes nothing about who gets which app.

| Module | What it does |
| --- | --- |
| `ab-common/jsonfile` | `readJson` and `writeJson`, safe in a OneDrive folder: retries while OneDrive has a file locked, never reads a damaged file as empty, and writes beside the file then renames it into place. |
| `ab-common/abapps` | What the apps take from [AB Apps](https://github.com/AB-Kevin/ab-apps): who is signed in (`readIdentity`, `watchIdentity`), its people list (`readDirectory`), and the mail server and website a manager set (`readServices`, `sharedServices`). Also `findABApps`. |
| `ab-common/releases` | Reading an app's latest release from its `latest.yml` and downloading the installer checked against its digest. `selfUpdates({ repo, installerName })` gives an app its own update check. |
| `ab-common/installs` | Finding an installed app from its `appId`, as electron-builder registers it, and opening it. |
| `ab-common/mailer` | Sending email over SMTP, without signing in when there's no user name, as AB Apps' mail server needs. |
| `ab-common/gravityforms` | Reading forms and entries from the website's Gravity Forms API with a read-only key. |
| `templates/release.yml` | The release workflow: copy it to an app's `.github/workflows/` and set its three values. |

None of it uses Electron, so it's tested with plain Node. Anything that goes online takes a `fetch`; the apps pass Electron's `net.fetch`, which uses Windows' proxy settings.

## Using it in an app

```
npm install git+https://github.com/AB-Kevin/ab-common.git#v1.0.0
```

The HTTPS address keeps package.json readable; package-lock.json records the tag's commit. npm downloads a public GitHub repository over HTTPS either way, so the release builds on GitHub need no key or token.

```js
const { readJson, writeJson } = require('ab-common/jsonfile');
const { selfUpdates } = require('ab-common/releases');
const { RELEASES_PAGE, checkForUpdate, downloadInstaller } = selfUpdates({
  repo: 'AB-Kevin/contractor-time',
  installerName: (version) => `KeepTime-Setup-${version}.exe`,
});
```

An app moves to a new version by changing the tag in its package.json and running `npm install`.

## Changing it

1. Change the code and its tests, and run `npm test`.
2. Commit, then `npm version patch` (or `minor` for something new, `major` for a change apps have to adapt to). That bumps the version, commits and tags `vX.Y.Z`.
3. `git push --follow-tags`. GitHub runs the tests on Windows.
4. In each app that should have it, change `#vX.Y.Z` in package.json, run `npm install`, and test the app.

A tag is never moved once pushed: an app's package-lock.json records the commit it points to.

## Which apps use it

| App | Uses |
| --- | --- |
| AB Apps | jsonfile, releases, installs, mailer, gravityforms |
| KeepTime | jsonfile, abapps, releases, installs, mailer |
| Duplicate Checker | jsonfile, abapps, releases |

BillManager, ApplicationManager, FormTracker and SendNewsletters still have their own copies. They update through electron-updater rather than `releases`, so they move over separately.
