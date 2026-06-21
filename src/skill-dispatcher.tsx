#!/usr/bin/env node
import { readdir, readFile, mkdir, lstat, readlink, realpath, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React, { useEffect, useMemo, useState } from "react";
import { render, Box, Text, useApp, useInput } from "ink";

// --- Types ---

interface Skill {
  name: string;
  path: string;
  source?: string;
}

interface SkillLockEntry {
  source: string;
  sourceType: string;
  skillPath: string;
  computedHash: string;
}

interface SkillsLock {
  version: number;
  skills: Record<string, SkillLockEntry>;
}

type LinkStatus = "created" | "skipped" | "conflict" | "failed";

type LinkFailureReason =
  | "target-exists"
  | "source-missing"
  | "unexpected";

interface LinkResult {
  skill: Skill;
  targetPath: string;
  status: LinkStatus;
  message: string;
  reason?: LinkFailureReason;
}

// --- Path resolution ---

function resolveDestinationPath(input: string, cwd = process.cwd()): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error("Destination path is required");
  }
  return path.resolve(cwd, trimmed);
}

function resolveToolRoot(): string {
  const cliFilePath = fileURLToPath(import.meta.url);
  return path.dirname(path.dirname(cliFilePath));
}

// --- Skill discovery ---

async function readSkillsLock(toolRoot: string): Promise<SkillsLock | null> {
  const lockPath = path.join(toolRoot, "inventory", "skills-lock.json");
  try {
    const content = await readFile(lockPath, "utf8");
    return JSON.parse(content) as SkillsLock;
  } catch (error) {
    if (isEnoent(error)) {
      return null;
    }
    throw error;
  }
}

async function discoverSkills(toolRoot: string): Promise<Skill[]> {
  const skillsDir = path.join(toolRoot, "inventory", ".agents", "skills");

  let entries;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch (error) {
    if (isEnoent(error)) {
      throw new Error(`No skills directory found at ${skillsDir}`);
    }
    throw error;
  }

  const lock = await readSkillsLock(toolRoot);

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: path.join(skillsDir, entry.name),
      source: lock?.skills?.[entry.name]?.source,
    }))
    .sort((left, right) => {
      const sourceCompare = (left.source ?? "").localeCompare(right.source ?? "");
      if (sourceCompare !== 0) {
        return sourceCompare;
      }
      return left.name.localeCompare(right.name);
    });
}

// --- Linking ---

async function linkSkills(
  skills: Skill[],
  destinationDir: string,
): Promise<LinkResult[]> {
  const linkType = process.platform === "win32" ? "junction" : "dir";
  await mkdir(destinationDir, { recursive: true });

  const results: LinkResult[] = [];
  for (const skill of skills) {
    const targetPath = path.join(destinationDir, skill.name);
    results.push(await linkOneSkill(skill, targetPath, linkType));
  }
  return results;
}

async function linkOneSkill(
  skill: Skill,
  targetPath: string,
  linkType: "dir" | "junction",
): Promise<LinkResult> {
  const existing = await getExistingTarget(targetPath);

  if (existing) {
    if (
      existing.isSymbolicLink() &&
      (await pointsToSamePath(targetPath, skill.path))
    ) {
      return {
        skill,
        targetPath,
        status: "skipped",
        message: `${skill.name} is already linked`,
      };
    }

    return {
      skill,
      targetPath,
      status: "conflict",
      reason: "target-exists",
      message: `Cannot link ${skill.name} because ${targetPath} already exists`,
    };
  }

  try {
    await symlink(skill.path, targetPath, linkType);
    return {
      skill,
      targetPath,
      status: "created",
      message: `Linked ${skill.name} to ${targetPath}`,
    };
  } catch (error) {
    const sourceMissing = isEnoent(error);
    return {
      skill,
      targetPath,
      status: "failed",
      reason: sourceMissing ? "source-missing" : "unexpected",
      message: sourceMissing
        ? `Cannot create link at ${targetPath} because the source skill is missing`
        : `Cannot create link at ${targetPath}: ${getErrorMessage(error)}`,
    };
  }
}

async function getExistingTarget(targetPath: string) {
  try {
    return await lstat(targetPath);
  } catch (error) {
    if (isEnoent(error)) {
      return null;
    }
    throw error;
  }
}

async function pointsToSamePath(
  linkPath: string,
  sourcePath: string,
): Promise<boolean> {
  try {
    const linkTarget = await readlink(linkPath);
    const absoluteLinkTarget = path.resolve(path.dirname(linkPath), linkTarget);
    return (
      (await realpath(absoluteLinkTarget)) ===
      (await realpath(sourcePath))
    );
  } catch {
    return false;
  }
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// --- TUI ---

type Stage = "select" | "destination" | "working" | "done";

function App({ skills, cwd = process.cwd() }: { skills: Skill[]; cwd?: string }) {
  const { exit } = useApp();
  const [stage, setStage] = useState<Stage>("select");
  const [cursor, setCursor] = useState(0);
  const [selectedNames, setSelectedNames] = useState<Set<string>>(() => new Set());
  const [destinationInput, setDestinationInput] = useState(() =>
    path.join(cwd, ".agents", "skills"),
  );
  const [results, setResults] = useState<LinkResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const selectedSkills = useMemo(
    () => skills.filter((skill) => selectedNames.has(skill.name)),
    [selectedNames, skills],
  );

  useEffect(() => {
    if (stage === "done") {
      exit();
    }
  }, [stage, exit]);

  useInput((input, key) => {
    if (key.escape || input === "q") {
      exit();
      return;
    }

    if (stage === "select") {
      if (key.upArrow) {
        setCursor((value) => Math.max(0, value - 1));
        return;
      }
      if (key.downArrow) {
        setCursor((value) => Math.min(skills.length - 1, value + 1));
        return;
      }
      if (input === " ") {
        const skill = skills[cursor];
        if (!skill) {
          return;
        }
        setSelectedNames((current) => {
          const next = new Set(current);
          if (next.has(skill.name)) {
            next.delete(skill.name);
          } else {
            next.add(skill.name);
          }
          return next;
        });
        return;
      }
      if (key.return && selectedNames.size > 0) {
        setStage("destination");
      }
      return;
    }

    if (stage === "destination") {
      if (key.backspace || key.delete) {
        setDestinationInput((value) => value.slice(0, -1));
        return;
      }
      if (key.return) {
        void runLink();
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setDestinationInput((value) => value + input);
      }
    }
  });

  async function runLink() {
    setError(null);
    let destinationPath: string;
    try {
      destinationPath = resolveDestinationPath(destinationInput, cwd);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return;
    }

    setStage("working");
    const linkResults = await linkSkills(selectedSkills, destinationPath);
    setResults(linkResults);
    setStage("done");
  }

  if (skills.length === 0) {
    return <Text>No skills found.</Text>;
  }

  return (
    <Box flexDirection="column" gap={1}>
      {stage === "select" && (
        <SelectScreen skills={skills} cursor={cursor} selectedNames={selectedNames} />
      )}
      {stage === "destination" && (
        <>
          <SelectScreen skills={skills} cursor={cursor} selectedNames={selectedNames} readOnly />
          <DestinationScreen value={destinationInput} error={error} />
        </>
      )}
      {stage === "working" && <Text>Linking selected skills...</Text>}
      {stage === "done" && <SummaryScreen results={results} />}
    </Box>
  );
}

function SelectScreen({
  skills,
  cursor,
  selectedNames,
  readOnly = false,
}: {
  skills: Skill[];
  cursor: number;
  selectedNames: Set<string>;
  readOnly?: boolean;
}) {
  const hasSources = skills.some((skill) => skill.source);

  return (
    <Box flexDirection="column">
      <Text>{readOnly ? "Selected skills:" : "Select skills with Space, then press Enter."}</Text>
      {skills.map((skill, index) => {
        const focused = index === cursor;
        const selected = selectedNames.has(skill.name);
        const showHeader =
          hasSources &&
          (index === 0 || skills[index - 1].source !== skill.source);

        return (
          <React.Fragment key={skill.name}>
            {showHeader && (
              <Text color="yellow">{skill.source ?? "(ungrouped)"}</Text>
            )}
            <Text color={focused && !readOnly ? "cyan" : undefined}>
              {focused && !readOnly ? ">" : " "} {hasSources ? "  " : ""}[{selected ? "x" : " "}] {skill.name}
            </Text>
          </React.Fragment>
        );
      })}
    </Box>
  );
}

function DestinationScreen({ value, error }: { value: string; error: string | null }) {
  return (
    <Box flexDirection="column">
      <Text>Destination path:</Text>
      <Text>{value}<Text color="cyan">▋</Text></Text>
      {error && <Text color="red">{error}</Text>}
      <Text dimColor>Press Enter to link selected skills.</Text>
    </Box>
  );
}

function SummaryScreen({ results }: { results: LinkResult[] }) {
  return (
    <Box flexDirection="column">
      <Text>Summary</Text>
      {results.map((result) => (
        <Text
          key={`${result.skill.name}-${result.status}`}
          color={result.status === "created" ? "green" : result.status === "failed" ? "red" : undefined}
        >
          {statusMarker(result.status)} {result.message}
        </Text>
      ))}
    </Box>
  );
}

function statusMarker(status: LinkResult["status"]) {
  switch (status) {
    case "created":
      return "+";
    case "skipped":
      return "-";
    case "conflict":
      return "!";
    case "failed":
      return "x";
  }
}

// --- Entry ---

async function main() {
  const toolRoot = resolveToolRoot();

  try {
    const skills = await discoverSkills(toolRoot);
    if (skills.length === 0) {
      console.error(`No skills found at ${toolRoot}/.agents/skills/`);
      process.exitCode = 1;
      return;
    }

    render(<App skills={skills} />);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

await main();
