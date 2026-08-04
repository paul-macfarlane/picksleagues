#!/usr/bin/env python3
"""Fail-closed Claude Code guardrail for files, commands, and egress."""

from __future__ import annotations

import json
import os
import re
import shlex
import sys
from pathlib import Path
from typing import Any

TEMPLATE_SUFFIXES = (".example", ".sample", ".template", ".dist", ".schema", ".pub")
SECRET_NAMES = {
    ".env",
    ".npmrc",
    ".pypirc",
    "credentials",
    "credentials.json",
    "service-account.json",
    "id_rsa",
    "id_ed25519",
}
SECRET_PATTERNS = (
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\b(?:sk|rk)-(?:live|prod)-[A-Za-z0-9_-]{12,}\b"),
    re.compile(
        r"(?i)\b(?:password|passwd|api[_-]?key|client[_-]?secret|access[_-]?token)\s*[:=]\s*['\"]?[A-Za-z0-9_./+=-]{12,}"
    ),
)


def is_template(path: str) -> bool:
    lowered = path.lower()
    return (
        lowered.endswith(TEMPLATE_SUFFIXES)
        or ".env." in lowered
        and lowered.endswith(TEMPLATE_SUFFIXES)
    )


def is_secret_path(path: str) -> bool:
    normalized = path.replace("\\", "/").lower().rstrip("/")
    name = normalized.rsplit("/", 1)[-1]
    if is_template(normalized):
        return False
    if name in SECRET_NAMES or name.startswith(".env."):
        return True
    if "/.aws/credentials" in normalized or "/.ssh/" in normalized:
        return not name.endswith(".pub")
    return name.endswith((".pem", ".p12", ".pfx", ".key"))


def secret_reason(text: str) -> str | None:
    for pattern in SECRET_PATTERNS:
        if pattern.search(text):
            return "possible secret material"
    return None


def shell_tokens(command: str) -> list[str]:
    """Tokenize shell text for classification, including quoted wrapper payloads."""

    def parse(value: str) -> list[str]:
        lexer = shlex.shlex(value, posix=True, punctuation_chars=";&|()<>")
        lexer.whitespace_split = True
        lexer.commenters = ""
        return list(lexer)

    try:
        tokens = parse(command)
    except ValueError:
        tokens = command.split()
    flattened: list[str] = []
    for token in tokens:
        if any(character.isspace() for character in token):
            try:
                nested = parse(token)
            except ValueError:
                nested = [token]
            flattened.extend(nested if len(nested) > 1 else [token])
        else:
            flattened.append(token)
    return flattened


def command_references_secret_path(tokens: list[str]) -> bool:
    for token in tokens:
        for candidate in re.split(r"[=,]", token):
            candidate = candidate.strip("'\"<>@")
            if candidate and is_secret_path(candidate):
                return True
    return False


def command_tail(tokens: list[str], executable: str) -> list[str] | None:
    value_options = {"-c", "--git-dir", "--work-tree", "--namespace"}
    for index, token in enumerate(tokens):
        if Path(token).name.lower() != executable:
            continue
        position = index + 1
        while position < len(tokens) and tokens[position].startswith("-"):
            option = tokens[position].split("=", 1)[0].lower()
            position += 2 if option in value_options and "=" not in tokens[position] else 1
        return tokens[position:]
    return None


def protected_branches() -> set[str]:
    defaults = {"main", "master", "develop", "staging", "production"}
    path = Path(os.environ.get("CLAUDE_PROJECT_DIR", ".")) / ".atlas/manifest.json"
    try:
        manifest = json.loads(path.read_text())
        configured = {
            branch
            for repository in manifest["repositories"]
            for branch in repository.get("protected_branches", [])
            if isinstance(branch, str)
        }
        return configured | defaults
    except (OSError, KeyError, TypeError, json.JSONDecodeError):
        return defaults


def human_only_states() -> set[str]:
    defaults = {"done"}
    path = Path(os.environ.get("CLAUDE_PROJECT_DIR", ".")) / ".atlas/manifest.json"
    try:
        manifest = json.loads(path.read_text())
        configured = {
            state.casefold()
            for state in manifest.get("human_only_states", [])
            if isinstance(state, str)
        }
        return configured or defaults
    except (OSError, TypeError, json.JSONDecodeError):
        return defaults


def classify_command(command: str) -> tuple[str, str] | None:
    compact = " ".join(command.split())
    lowered = compact.lower()
    tokens = shell_tokens(compact)
    lowered_tokens = [token.lower() for token in tokens]

    if command_references_secret_path(tokens):
        return "deny", "access to live secret-bearing files through Bash is prohibited"

    git_tail = command_tail(tokens, "git")
    if git_tail:
        git_lower = [token.lower() for token in git_tail]
        subcommand = git_lower[0] if git_lower else ""
        arguments = git_lower[1:]
        if subcommand == "reset" and "--hard" in arguments:
            return "deny", "git reset --hard destroys uncommitted work"
        if subcommand in {"commit", "push"} and "--no-verify" in arguments:
            return "deny", "--no-verify bypasses repository hooks"
        if subcommand == "push" and any(
            token in {"-f", "--force", "--force-with-lease"}
            or token.startswith(("--force=", "--force-with-lease="))
            for token in arguments
        ):
            return "deny", "force-push is prohibited"
        if subcommand == "push":
            for token in arguments:
                destination = token.lstrip("+").rsplit(":", 1)[-1]
                destination = destination.removeprefix("refs/heads/")
                if destination in {branch.lower() for branch in protected_branches()}:
                    return "deny", f"direct push to protected branch {destination!r} is prohibited"

    mutation_commands = {
        "terraform": {"apply", "destroy", "import", "taint", "untaint"},
        "cdk": {"deploy", "destroy"},
        "kubectl": {"apply", "create", "delete", "edit", "patch", "replace", "scale", "set"},
        "helm": {"install", "upgrade", "uninstall", "rollback"},
    }
    for executable, mutations in mutation_commands.items():
        for index, token in enumerate(lowered_tokens):
            if Path(token).name != executable:
                continue
            if any(candidate in mutations for candidate in lowered_tokens[index + 1 :]):
                return (
                    "deny",
                    "cloud or infrastructure mutations are denied by default; use a durable, narrowly scoped human-approved exception",
                )

    denied = (
        (r"\bgit\b.*\breset\b.*--hard\b", "git reset --hard destroys uncommitted work"),
        (
            r"\bgit\b.*\bclean\b(?![^;&|]*(?:--dry-run|\s-[a-z]*n))",
            "git clean can delete untracked work; use a dry run",
        ),
        (
            r"\bgit\b.*\bcheckout\b\s+(?:head\s+)?--\s",
            "git checkout -- discards file changes",
        ),
        (
            r"\bgit\b.*\brestore\b(?![^;&|]*(?:--staged|\s-[a-z]*s)(?![^;&|]*(?:--worktree|\s-[a-z]*w)))",
            "git restore can discard file changes",
        ),
        (
            r"\bgit\b.*\bbranch\b.*(?:\s-D\b|--delete.*--force|--force.*--delete)",
            "force-deleting a branch can orphan work",
        ),
        (
            r"\bgit\b.*\bstash\b\s+(?:drop|clear)\b",
            "dropping stashes destroys recoverable work",
        ),
        (
            r"\bgit\b.*\b(?:commit|push)\b.*--no-verify\b",
            "--no-verify bypasses repository hooks",
        ),
        (
            r"\bgit\b.*\bpush\b.*(?:--force(?:-with-lease)?|-f)\b",
            "force-push is prohibited",
        ),
        (
            r"\bgit\b.*\bremote\b\s+(?:add|remove|rename|set-url)\b",
            "remote changes require a human",
        ),
        (
            r"\bgit\b.*\bconfig\b.*(?:credential|core\.hookspath|remote\.|url\.)",
            "credential, hook-path, and remote configuration are guarded",
        ),
        (r"\b(?:gh\s+pr|glab\s+mr)\s+merge\b", "merging is a human action"),
        (
            r"\b(?:gh|glab)\b.*\b(?:secret|token)\b",
            "credential management is a human action",
        ),
    )
    for pattern, reason in denied:
        if re.search(pattern, lowered):
            return "deny", reason

    push = re.search(r"\bgit\b(?:\s+-\S+(?:\s+\S+)*)*\s+push\b([^;&|]*)", lowered)
    if push:
        tail = push.group(1)
        for branch in protected_branches():
            escaped = re.escape(branch.lower())
            if re.search(rf"(?:^|[\s:]){escaped}(?:$|\s)", tail):
                return (
                    "deny",
                    f"direct push to protected branch {branch!r} is prohibited",
                )

    cloud_mutations = (
        r"\bterraform\s+(?:apply|destroy|import|taint|untaint|state\s+(?:rm|mv|push))\b",
        r"\bcdk\s+(?:deploy|destroy)\b",
        r"\bkubectl\s+(?:apply|create|delete|edit|patch|replace|scale|set)\b",
        r"\bhelm\s+(?:install|upgrade|uninstall|rollback)\b",
        r"\baws\b.*\b(?:create|delete|put|update|terminate|run-instances|start|stop)[a-z-]*\b",
    )
    if any(re.search(pattern, lowered) for pattern in cloud_mutations):
        return (
            "deny",
            "cloud or infrastructure mutations are denied by default; use a durable, narrowly scoped human-approved exception",
        )

    # AWS adds mutating operations frequently. Treat only clearly read-only
    # operation prefixes as safe instead of relying on an incomplete mutation
    # denylist. This also recognizes direct RTK-wrapped invocations because the
    # logical `aws <service> <operation>` tokens remain present.
    try:
        tokens = shlex.split(compact)
    except ValueError:
        tokens = compact.split()
    if len(tokens) > 2 and Path(tokens[0]).name == "rtk" and tokens[1] in {"run", "proxy"}:
        try:
            tokens = shlex.split(tokens[2]) + tokens[3:]
        except ValueError:
            tokens = tokens[2].split() + tokens[3:]
    for index, token in enumerate(tokens):
        if Path(token).name != "aws":
            continue
        tail = tokens[index + 1 :]
        position = 0
        value_options = {
            "--ca-bundle",
            "--cli-connect-timeout",
            "--cli-read-timeout",
            "--endpoint-url",
            "--output",
            "--profile",
            "--query",
            "--region",
        }
        while position < len(tail) and tail[position].startswith("-"):
            option = tail[position].split("=", 1)[0]
            if "=" in tail[position] or option not in value_options:
                position += 1
            else:
                position += 2 if position + 1 < len(tail) else 1
        if len(tail) - position < 2:
            continue
        operation = tail[position + 1].lower()
        read_only_prefixes = (
            "batch-get",
            "describe",
            "detect",
            "get",
            "head",
            "list",
            "lookup",
            "search",
            "validate",
        )
        if not operation.startswith(read_only_prefixes):
            return (
                "deny",
                "AWS mutations are denied by default; only confirmed read-only operations are allowed",
            )

    egress = re.search(r"\b(?:curl|wget|nc|ncat|scp|rsync)\b", lowered)
    sensitive_source = re.search(
        r"(?:\.env(?:\s|$)|credentials|id_rsa|id_ed25519|\.pem\b|\.p12\b|\.key\b)",
        lowered,
    )
    if egress and sensitive_source:
        return "deny", "outbound transfer of secret-bearing material is prohibited"

    reason = secret_reason(command)
    if reason:
        return "deny", reason + " in command"
    return None


def decision(level: str, reason: str) -> dict[str, Any]:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": level,
            "permissionDecisionReason": reason,
        }
    }


def nested_strings(value: Any):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for nested in value.values():
            yield from nested_strings(nested)
    elif isinstance(value, list):
        for nested in value:
            yield from nested_strings(nested)


def nested_string_items(value: Any):
    if isinstance(value, dict):
        for key, nested in value.items():
            if isinstance(nested, str):
                yield str(key), nested
            else:
                yield from nested_string_items(nested)
    elif isinstance(value, list):
        for nested in value:
            yield from nested_string_items(nested)


def classify_mcp(payload: dict[str, Any], tool_input: dict[str, Any]) -> tuple[str, str] | None:
    tool_name = payload.get("tool_name")
    if not isinstance(tool_name, str) or not tool_name.startswith("mcp__"):
        return "deny", "malformed MCP tool name; guardrail fails closed"

    lowered_name = tool_name.casefold().replace("-", "_")
    values = list(nested_strings(tool_input))
    lowered_values = [value.casefold() for value in values]
    string_items = list(nested_string_items(tool_input))

    if any(is_secret_path(value) for value in values):
        return "deny", "MCP access to live secret-bearing files is prohibited"
    if any(secret_reason(value) for value in values):
        return "deny", "MCP input contains possible secret material"

    sensitive_actions = ("secret", "credential", "access_token", "private_key")
    if any(action in lowered_name for action in sensitive_actions):
        return "deny", "credential and secret operations are human actions"
    if re.search(r"(?:^|_)(merge)(?:_|$)", lowered_name):
        return "deny", "merging is a human action"
    if any(re.search(r"(?:^|[/_])merge(?:$|[/_])", value) for value in lowered_values):
        return "deny", "merging through a generic MCP operation is prohibited"

    cloud_markers = (
        "aws",
        "azure",
        "gcp",
        "google_cloud",
        "terraform",
        "tofu",
        "pulumi",
        "cloudformation",
        "cdk",
        "kubernetes",
        "kubectl",
        "helm",
    )
    mutation_markers = (
        "apply",
        "create",
        "delete",
        "deploy",
        "destroy",
        "import",
        "install",
        "invoke",
        "patch",
        "put",
        "run",
        "set",
        "start",
        "stop",
        "terminate",
        "update",
        "upgrade",
        "write",
    )
    if any(marker in lowered_name for marker in cloud_markers) and any(
        re.search(rf"(?:^|_){marker}(?:_|$)", lowered_name) for marker in mutation_markers
    ):
        return "deny", "cloud or infrastructure mutations through MCP are denied by default"

    if any(marker in lowered_name for marker in cloud_markers) and any(
        marker in value for marker in mutation_markers for value in lowered_values
    ):
        return "deny", "cloud or infrastructure mutations through MCP are denied by default"

    for key, value in string_items:
        if "command" in key.casefold():
            result = classify_command(value)
            if result:
                return result

    transition_markers = ("transition", "status", "state", "update_issue", "edit_issue")
    if any(marker in lowered_name for marker in transition_markers) and any(
        value.strip().casefold() in human_only_states() for value in lowered_values
    ):
        return "deny", "transition to a configured human-only state is prohibited"

    source_markers = ("github", "gitlab", "bitbucket")
    ref_mutations = (
        "push",
        "force",
        "update_ref",
        "create_ref",
        "delete_ref",
        "delete_branch",
        "create_or_update_file",
        "push_files",
        "commit_files",
        "create_commit",
    )
    if any(marker in lowered_name for marker in source_markers) and any(
        marker in lowered_name for marker in ref_mutations
    ):
        normalized_values = {
            value.removeprefix("refs/heads/").strip().casefold() for value in lowered_values
        }
        if (
            "delete_ref" in lowered_name
            or "delete_branch" in lowered_name
            or "force" in lowered_name
        ):
            return "deny", "remote deletion and force updates are human actions"
        if normalized_values & {branch.casefold() for branch in protected_branches()}:
            return "deny", "MCP update to a protected branch is prohibited"
    return None


def classify_payload(payload: dict[str, Any], mode: str) -> tuple[str, str] | None:
    tool_input = payload.get("tool_input", {})
    if not isinstance(tool_input, dict):
        return "deny", "malformed tool input; guardrail fails closed"
    if mode == "bash":
        command = tool_input.get("command", "")
        if not isinstance(command, str):
            return "deny", "malformed Bash command; guardrail fails closed"
        return classify_command(command)
    if mode == "mcp":
        return classify_mcp(payload, tool_input)

    paths = [tool_input.get(key) for key in ("file_path", "path", "notebook_path")]
    for path in (p for p in paths if isinstance(p, str)):
        if is_secret_path(path):
            return (
                "deny",
                f"access to live secret-bearing file {Path(path).name!r} is prohibited",
            )
    for key in ("content", "new_string", "command"):
        value = tool_input.get(key)
        if isinstance(value, str) and secret_reason(value):
            return "deny", "write contains possible secret material"
    return None


def self_test() -> int:
    cases = [
        (is_secret_path(".env"), True, "live env denied"),
        (is_secret_path(".env.example"), False, "env template allowed"),
        (is_secret_path("id_rsa.pub"), False, "public key allowed"),
        (classify_command("git clean -n") is None, True, "git clean dry-run allowed"),
        (classify_command("git reset --hard HEAD")[0], "deny", "hard reset denied"),
        (classify_command("terraform plan") is None, True, "terraform plan allowed"),
        (
            classify_command("terraform apply plan.out")[0],
            "deny",
            "terraform apply denied",
        ),
        (
            classify_command("aws ec2 modify-instance-attribute --instance-id i-123")[0],
            "deny",
            "AWS mutation denied",
        ),
        (classify_command("aws ec2 describe-instances") is None, True, "AWS read allowed"),
        (classify_command("gh pr merge 42")[0], "deny", "merge denied"),
        (
            classify_mcp(
                {"tool_name": "mcp__github__merge_pull_request"},
                {"pull_number": 42},
            )[0],
            "deny",
            "MCP merge denied",
        ),
        (
            classify_mcp(
                {"tool_name": "mcp__github__get_pull_request"},
                {"pull_number": 42},
            )
            is None,
            True,
            "MCP read allowed",
        ),
    ]
    failed = [name for actual, expected, name in cases if actual != expected]
    print("guard self-test: " + ("PASS" if not failed else "FAIL: " + ", ".join(failed)))
    return 0 if not failed else 1


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode not in {"file", "bash", "mcp"}:
        print(json.dumps(decision("deny", "invalid guard mode; guardrail fails closed")))
        return 0
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict):
            raise ValueError("payload is not an object")
        result = classify_payload(payload, mode)
    except Exception as exc:  # fail closed for enforcement
        print(
            json.dumps(
                decision(
                    "deny",
                    f"guardrail could not evaluate tool input: {type(exc).__name__}",
                )
            )
        )
        return 0
    if result:
        print(json.dumps(decision(*result)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
