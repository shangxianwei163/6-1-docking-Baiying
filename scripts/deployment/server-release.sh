#!/usr/bin/env bash

set -Eeuo pipefail

readonly APP_ROOT='/www/wwwroot/scheduling.paiyide.cc'
readonly BACKUP_ROOT='/www/backup/scheduling-paiyide-releases'
readonly LOCK_FILE='/var/lock/scheduling-paiyide-release.lock'
readonly RUN_USER='www'
readonly RUN_GROUP='www'

NODE_BIN=''

log() {
  printf '[production-release] %s\n' "$*"
}

fail() {
  log "ERROR: $*" >&2
  exit 1
}

is_safe_relative_path() {
  local path="$1"
  [[ -n "$path" ]] || return 1
  [[ "$path" != /* ]] || return 1
  [[ "$path" != '.' && "$path" != '..' ]] || return 1
  [[ "$path" != ../* && "$path" != */../* && "$path" != */.. ]] || return 1
  return 0
}

validate_managed_file() {
  local manifest="$1"
  local source_root="$2"
  local path

  [[ -s "$manifest" ]] || fail 'managed-file manifest is missing or empty'
  while IFS= read -r path; do
    is_safe_relative_path "$path" || fail "unsafe managed path: $path"
    [[ -f "$source_root/$path" ]] || fail "managed file is missing: $path"
    [[ ! -L "$source_root/$path" ]] || fail "symbolic links are not allowed: $path"
  done < "$manifest"
}

remove_managed_files() {
  local manifest="$1"
  local path

  [[ -f "$manifest" ]] || return 0
  while IFS= read -r path; do
    is_safe_relative_path "$path" || fail "unsafe managed path during removal: $path"
    rm -f -- "$APP_ROOT/$path"
  done < "$manifest"
}

find_npm() {
  local candidate
  candidate="$(command -v npm 2>/dev/null || true)"
  if [[ -n "$candidate" ]]; then
    printf '%s\n' "$candidate"
    return 0
  fi

  candidate="$(find /www/server/nodejs -mindepth 3 -maxdepth 3 -path '*/bin/npm' \( -type f -o -type l \) 2>/dev/null | sort -V | tail -n 1)"
  [[ -n "$candidate" ]] || fail 'npm was not found on the production server'
  printf '%s\n' "$candidate"
}

find_node() {
  local candidate
  candidate="$(command -v node 2>/dev/null || true)"
  if [[ -n "$candidate" ]]; then
    printf '%s\n' "$candidate"
    return 0
  fi

  candidate="$(find /www/server/nodejs -mindepth 3 -maxdepth 3 -type f -path '*/bin/node' 2>/dev/null | sort -V | tail -n 1)"
  [[ -n "$candidate" ]] || fail 'node was not found on the production server'
  printf '%s\n' "$candidate"
}

backup_current_release() {
  local backup_dir="$1"
  local existing_files="$backup_dir/existing-managed-files"
  mkdir -p "$backup_dir"

  if [[ -s "$APP_ROOT/.production-managed-files" ]]; then
    : > "$existing_files"
    while IFS= read -r path; do
      is_safe_relative_path "$path" || fail "unsafe existing managed path: $path"
      if [[ -f "$APP_ROOT/$path" || -L "$APP_ROOT/$path" ]]; then
        printf '%s\n' "$path" >> "$existing_files"
      fi
    done < "$APP_ROOT/.production-managed-files"
    tar -czf "$backup_dir/managed.tar.gz" -C "$APP_ROOT" -T "$existing_files"
    printf 'managed\n' > "$backup_dir/mode"
  else
    tar \
      --exclude='node_modules' \
      --exclude='./.env' \
      --exclude='./.env.local' \
      --exclude='./.env.*.local' \
      --exclude='./.codex-backups' \
      --exclude='./.local-recordings' \
      --exclude='./logs' \
      -czf "$backup_dir/managed.tar.gz" \
      -C "$APP_ROOT" .
    printf 'full\n' > "$backup_dir/mode"
  fi
}

restore_backup() {
  local backup_dir="$1"
  local current_manifest="${2:-$APP_ROOT/.production-managed-files}"

  [[ -f "$backup_dir/managed.tar.gz" ]] || fail "rollback archive is missing: $backup_dir"
  remove_managed_files "$current_manifest"
  tar -xzf "$backup_dir/managed.tar.gz" -C "$APP_ROOT"

  if [[ -d "$backup_dir/dependencies" ]]; then
    local dependency_path
    local failed_dependencies="$backup_dir/dependencies.failed.$(date -u +%Y%m%dT%H%M%SZ)"
    for dependency_path in node_modules outbound-platform-api/node_modules outbound-contracts/node_modules; do
      if [[ -d "$APP_ROOT/$dependency_path" ]]; then
        mkdir -p "$failed_dependencies/$(dirname "$dependency_path")"
        mv "$APP_ROOT/$dependency_path" "$failed_dependencies/$dependency_path"
      fi
      if [[ -d "$backup_dir/dependencies/$dependency_path" ]]; then
        mkdir -p "$APP_ROOT/$(dirname "$dependency_path")"
        mv "$backup_dir/dependencies/$dependency_path" "$APP_ROOT/$dependency_path"
      fi
    done
  fi

  chown -R "$RUN_USER:$RUN_GROUP" "$APP_ROOT"
}

deploy_release() {
  local artifact="${1:-}"
  local expected_sha="${2:-}"
  local expected_commit="${3:-}"

  [[ "$artifact" == /tmp/scheduling-paiyide-release-*/*.tar.gz ]] || fail 'artifact path is outside the release inbox'
  [[ -f "$artifact" && ! -L "$artifact" ]] || fail 'release artifact does not exist'
  [[ "$expected_sha" =~ ^[0-9a-f]{64}$ ]] || fail 'invalid artifact SHA-256'
  [[ "$expected_commit" =~ ^[0-9a-f]{40}$ ]] || fail 'invalid Git commit'

  local actual_sha
  actual_sha="$(sha256sum "$artifact" | awk '{print $1}')"
  [[ "$actual_sha" == "$expected_sha" ]] || fail 'release artifact checksum mismatch'

  local archive_path
  while IFS= read -r archive_path; do
    archive_path="${archive_path#./}"
    [[ -z "$archive_path" ]] && continue
    [[ "$archive_path" != /* ]] || fail "unsafe absolute archive path: $archive_path"
    [[ "$archive_path" != '..' && "$archive_path" != ../* && "$archive_path" != */../* && "$archive_path" != */.. ]] ||
      fail "unsafe parent archive path: $archive_path"
  done < <(tar -tzf "$artifact")

  local stage
  stage="$(mktemp -d /www/wwwroot/.scheduling-paiyide-release.XXXXXX)"
  local dependency_stage="${stage}.dependencies"
  trap 'rm -rf -- "$stage" "$dependency_stage"' RETURN
  tar -xzf "$artifact" -C "$stage"

  [[ -f "$stage/package.json" ]] || fail 'package.json is missing from the release'
  [[ -f "$stage/package-lock.json" ]] || fail 'package-lock.json is missing from the release'
  [[ -f "$stage/dist/server/index.js" ]] || fail 'frontend build is missing from the release'
  [[ -f "$stage/outbound-platform-api/dist/server.js" ]] || fail 'API build is missing from the release'
  [[ -f "$stage/outbound-contracts/dist/index.js" ]] || fail 'contract build is missing from the release'
  [[ -f "$stage/.production-release.json" ]] || fail 'release metadata is missing'
  [[ -z "$(find "$stage" -type l -print -quit)" ]] || fail 'release contains an unsupported symbolic link'

  validate_managed_file "$stage/.production-managed-files" "$stage"

  local artifact_commit
  artifact_commit="$("$NODE_BIN" -e "const f=require('fs');const p=JSON.parse(f.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(p.commit||''))" "$stage/.production-release.json")"
  [[ "$artifact_commit" == "$expected_commit" ]] || fail 'release commit does not match the requested commit'

  local dependencies_changed='1'
  if [[ -f "$APP_ROOT/package-lock.json" && -d "$APP_ROOT/node_modules" ]] && cmp -s "$stage/package-lock.json" "$APP_ROOT/package-lock.json"; then
    dependencies_changed='0'
  fi

  if [[ "$dependencies_changed" == '1' ]]; then
    local npm_bin npm_path
    npm_bin="$(find_npm)"
    npm_path="$(dirname "$npm_bin"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
    log 'dependency lock changed; installing dependencies once in staging'
    chown -R "$RUN_USER:$RUN_GROUP" "$stage"
    runuser -u "$RUN_USER" -- env PATH="$npm_path" "$npm_bin" ci --no-audit --no-fund --prefix "$stage"
  else
    log 'dependency lock unchanged; reusing production node_modules'
  fi

  if [[ "$dependencies_changed" == '1' ]]; then
    local dependency_path
    mkdir -p "$dependency_stage"
    for dependency_path in node_modules outbound-platform-api/node_modules outbound-contracts/node_modules; do
      if [[ -d "$stage/$dependency_path" ]]; then
        mkdir -p "$dependency_stage/$(dirname "$dependency_path")"
        mv "$stage/$dependency_path" "$dependency_stage/$dependency_path"
      fi
    done
  fi

  local old_commit='legacy'
  if [[ -f "$APP_ROOT/.production-release.json" ]]; then
    old_commit="$("$NODE_BIN" -e "const f=require('fs');try{const p=JSON.parse(f.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(p.commit||'legacy').slice(0,12))}catch{process.stdout.write('legacy')}" "$APP_ROOT/.production-release.json")"
  fi
  local backup_id backup_dir
  backup_id="$(date -u +%Y%m%dT%H%M%SZ)-${old_commit}"
  backup_dir="$BACKUP_ROOT/$backup_id"
  backup_current_release "$backup_dir"

  local apply_started='0'
  on_deploy_error() {
    local status="$?"
    trap - ERR
    if [[ "$apply_started" == '1' ]]; then
      log 'deployment failed while switching files; restoring the previous release'
      restore_backup "$backup_dir" "$stage/.production-managed-files" || true
    fi
    exit "$status"
  }
  trap on_deploy_error ERR

  apply_started='1'
  if [[ -s "$APP_ROOT/.production-managed-files" ]]; then
    local old_path
    while IFS= read -r old_path; do
      is_safe_relative_path "$old_path" || fail "unsafe old managed path: $old_path"
      if ! grep -Fqx -- "$old_path" "$stage/.production-managed-files"; then
        rm -f -- "$APP_ROOT/$old_path"
      fi
    done < "$APP_ROOT/.production-managed-files"
  fi

  chown -R "$RUN_USER:$RUN_GROUP" "$stage"
  cp -a "$stage/." "$APP_ROOT/"

  if [[ "$dependencies_changed" == '1' ]]; then
    local dependency_path
    for dependency_path in node_modules outbound-platform-api/node_modules outbound-contracts/node_modules; do
      if [[ -d "$APP_ROOT/$dependency_path" ]]; then
        mkdir -p "$backup_dir/dependencies/$(dirname "$dependency_path")"
        mv "$APP_ROOT/$dependency_path" "$backup_dir/dependencies/$dependency_path"
      fi
      if [[ -d "$dependency_stage/$dependency_path" ]]; then
        mkdir -p "$APP_ROOT/$(dirname "$dependency_path")"
        mv "$dependency_stage/$dependency_path" "$APP_ROOT/$dependency_path"
      fi
    done
  fi

  printf '%s\n' "$backup_id" > "$BACKUP_ROOT/last"
  chmod 600 "$BACKUP_ROOT/last"
  trap - ERR

  log "release staged successfully: $expected_commit"
  log "backup id: $backup_id"
  printf 'DEPLOY_RESULT backup_id=%s dependencies_changed=%s\n' "$backup_id" "$dependencies_changed"
}

rollback_release() {
  local backup_id="${1:-}"
  if [[ -z "$backup_id" || "$backup_id" == 'last' ]]; then
    [[ -f "$BACKUP_ROOT/last" ]] || fail 'no previous release backup was recorded'
    backup_id="$(<"$BACKUP_ROOT/last")"
  fi
  [[ "$backup_id" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-z]+$ ]] || fail 'invalid backup id'

  local backup_dir="$BACKUP_ROOT/$backup_id"
  [[ -d "$backup_dir" ]] || fail "backup does not exist: $backup_id"
  restore_backup "$backup_dir"
  log "rollback completed: $backup_id"
  printf 'ROLLBACK_RESULT backup_id=%s\n' "$backup_id"
}

main() {
  [[ "$(id -u)" == '0' ]] || fail 'server release script must run as root'
  [[ -d "$APP_ROOT" && ! -L "$APP_ROOT" ]] || fail 'production application root is missing or is a symbolic link'
  command -v flock >/dev/null || fail 'flock is required'
  command -v cp >/dev/null || fail 'cp is required'
  NODE_BIN="$(find_node)"
  mkdir -p "$BACKUP_ROOT"

  exec 9>"$LOCK_FILE"
  flock -n 9 || fail 'another production deployment is already running'

  case "${1:-}" in
    deploy)
      shift
      deploy_release "$@"
      ;;
    rollback)
      shift
      rollback_release "$@"
      ;;
    preflight)
      log "server preflight passed for $APP_ROOT"
      ;;
    *)
      fail 'usage: server-release.sh deploy <artifact> <sha256> <commit> | rollback [backup-id|last] | preflight'
      ;;
  esac
}

main "$@"
