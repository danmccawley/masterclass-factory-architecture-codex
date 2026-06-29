// lib/publish/github.js
//
// GitHub Git Data API publish logic, extracted from api/generate.js (Sprint 3,
// step 3 — behavior-preserving). This module OWNS the two functions that were
// previously inline in generate.js: githubRequest() (the authenticated
// api.github.com fetch wrapper) and publishToGitHub() (the blobs -> tree ->
// commit -> ref-update sequence that auto-publishes a generated class to
// classes/<slug>/ on the configured branch).
//
// The logic is IDENTICAL to the prior inline code: same env-var precedence,
// same not_configured short-circuit, same static file list, same Git Data API
// call order, same return shapes. Nothing here decides WHETHER to publish —
// generate.js still gates on publishRequested and still owns the .catch() that
// maps a thrown error to the { status: "failed" } shape.
//
// slugify() and baseUrl() now live in lib/util.js (Sprint 3, module 4) and are
// required directly. They were briefly injected as a deps object while those
// helpers still lived in generate.js (which would have been a circular require);
// with a shared util module they have a real home, so the injection is gone.
"use strict";

const { slugify, baseUrl } = require("../util.js");

async function githubRequest(pathname, options) {
  const token = String(process.env.GITHUB_TOKEN || "").trim();
  const response = await fetch(`https://api.github.com${pathname}`, {
    method: options.method || "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "masterclass-factory"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload && payload.message ? payload.message : `GitHub API ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

async function publishToGitHub(req, brief, bundle) {
  const token = String(process.env.GITHUB_TOKEN || "").trim();
  const owner = String(process.env.GITHUB_OWNER || process.env.VERCEL_GIT_REPO_OWNER || "").trim();
  const repo = String(process.env.GITHUB_REPO || process.env.VERCEL_GIT_REPO_SLUG || "").trim();
  const branch = String(process.env.GITHUB_BRANCH || "main").trim();
  const slug = slugify(brief.meta.slug || brief.meta.title);
  const folder = `classes/${slug}`;
  const expectedBase = baseUrl(req);
  const expectedUrl = expectedBase ? `${expectedBase}/${folder}/` : "";

  if (!token || !owner || !repo) {
    return {
      status: "not_configured",
      message: "Generation succeeded. Auto-publish needs GITHUB_TOKEN plus repo owner/name env vars in Vercel.",
      class_path: folder,
      expected_url: expectedUrl
    };
  }

  const staticNames = [
    "index.html",
    "engine.js",
    "navscrubber.js",
    "content.js",
    "glossary.js",
    "source.js",
    "presenter-script.md",
    "student-handout.md",
    "facilitator-guide.md",
    "quiz-answer-key.md",
    "evidence-map.json",
    "class-blueprint.json",
    "class-record.json"
  ];
  const ref = await githubRequest(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, {});
  const currentCommit = await githubRequest(`/repos/${owner}/${repo}/git/commits/${ref.object.sha}`, {});
  const tree = [];

  for (const name of staticNames) {
    const blob = await githubRequest(`/repos/${owner}/${repo}/git/blobs`, {
      method: "POST",
      body: { content: bundle.files[name], encoding: "utf-8" }
    });
    tree.push({
      path: `${folder}/${name}`,
      mode: "100644",
      type: "blob",
      sha: blob.sha
    });
  }

  const newTree = await githubRequest(`/repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    body: { base_tree: currentCommit.tree.sha, tree }
  });
  const newCommit = await githubRequest(`/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    body: {
      message: `Add generated masterclass: ${brief.meta.title || slug}`,
      tree: newTree.sha,
      parents: [ref.object.sha]
    }
  });
  await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: "PATCH",
    body: { sha: newCommit.sha }
  });

  return {
    status: "published",
    message: "Generated masterclass committed to GitHub. The GitHub to Vercel connection should deploy it automatically.",
    owner,
    repo,
    branch,
    commit_sha: newCommit.sha,
    class_path: folder,
    expected_url: expectedUrl
  };
}

module.exports = {
  githubRequest: githubRequest,
  publishToGitHub: publishToGitHub
};
