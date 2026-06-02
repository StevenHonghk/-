# GitHub Upload Guide

## Recommended Upload Contents

Upload the clean project files only:

- `.gitignore`
- `README.md`
- `TAMPERMONKEY.md`
- `GITHUB_UPLOAD_GUIDE.md`
- `package.json`
- `package-lock.json`
- `tampermonkey-sequence-autofill.user.js`
- `src/`
- `test/`
- `configs/example.json`
- `configs/sequence.example.json`
- `configs/values.example.txt`
- `*.bat`

## Do Not Upload

These files can contain local cache, personal browser data, or real fill values:

- `node_modules/`
- `configs/edge-profile/`
- `configs/current-tab-profile/`
- `configs/local.json`
- `configs/sequence.json`
- `configs/values.txt`
- `.env`
- log, temp, and backup files

## GitHub Web Upload

Use the prepared `github-upload/edge-autofill-safe` folder. It already excludes local-only files.

## After Cloning

```powershell
npm install
npm test
```

For local configuration, copy the example files:

```powershell
Copy-Item configs\example.json configs\local.json
Copy-Item configs\sequence.example.json configs\sequence.json
Copy-Item configs\values.example.txt configs\values.txt
```
