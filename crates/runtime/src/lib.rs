//! Trusted local execution boundary for Landache.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

pub const PROTOCOL_VERSION: u8 = 1;
pub const RUNTIME_METHODS: [&str; 3] = ["read_file", "list_directory", "search_text"];
pub const MAX_FILE_BYTES: u64 = 1024 * 1024;
pub const MAX_DIRECTORY_ENTRIES: usize = 1_000;
pub const MAX_SEARCH_FILES: usize = 10_000;
pub const MAX_SEARCH_MATCHES: usize = 200;
pub const MAX_SEARCH_OUTPUT_BYTES: usize = 256 * 1024;
pub const RUNTIME_ERROR_CODES: [&str; 9] = [
    INVALID_REQUEST,
    PATH_OUTSIDE_WORKSPACE,
    NOT_FOUND,
    NOT_A_FILE,
    NOT_A_DIRECTORY,
    PERMISSION_DENIED,
    OUTPUT_LIMIT_EXCEEDED,
    INVALID_UTF8,
    INTERNAL_ERROR,
];
const INVALID_REQUEST: &str = "invalid_request";
const PATH_OUTSIDE_WORKSPACE: &str = "path_outside_workspace";
const NOT_FOUND: &str = "not_found";
const NOT_A_FILE: &str = "not_a_file";
const NOT_A_DIRECTORY: &str = "not_a_directory";
const PERMISSION_DENIED: &str = "permission_denied";
const OUTPUT_LIMIT_EXCEEDED: &str = "output_limit_exceeded";
const INVALID_UTF8: &str = "invalid_utf8";
const INTERNAL_ERROR: &str = "internal_error";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeRequest {
    pub version: u8,
    pub id: String,
    #[serde(flatten)]
    pub operation: RuntimeOperation,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "method", content = "params", rename_all = "snake_case")]
pub enum RuntimeOperation {
    ReadFile(ReadFileParams),
    ListDirectory(ListDirectoryParams),
    SearchText(SearchTextParams),
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReadFileParams {
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListDirectoryParams {
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SearchTextParams {
    pub path: String,
    pub query: String,
}

#[derive(Debug, Serialize)]
pub struct RuntimeResponse {
    pub version: u8,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<RuntimeResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RuntimeError>,
}

#[derive(Debug, Serialize)]
pub struct ReadFileResult {
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum RuntimeResult {
    ReadFile(ReadFileResult),
    ListDirectory(ListDirectoryResult),
    SearchText(SearchTextResult),
}

#[derive(Debug, Serialize)]
pub struct ListDirectoryResult {
    pub entries: Vec<DirectoryEntry>,
}

#[derive(Debug, Serialize)]
pub struct DirectoryEntry {
    pub path: String,
    #[serde(rename = "type")]
    pub entry_type: DirectoryEntryType,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DirectoryEntryType {
    File,
    Directory,
    Symlink,
}

#[derive(Debug, Serialize)]
pub struct SearchTextResult {
    pub matches: Vec<SearchTextMatch>,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct SearchTextMatch {
    pub path: String,
    pub line: usize,
    pub column: usize,
    pub preview: String,
}

#[derive(Debug, Serialize)]
pub struct RuntimeError {
    pub code: &'static str,
    pub message: String,
}

impl RuntimeResponse {
    pub fn success(id: String, result: RuntimeResult) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            id,
            result: Some(result),
            error: None,
        }
    }

    pub fn failure(id: String, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            id,
            result: None,
            error: Some(RuntimeError {
                code,
                message: message.into(),
            }),
        }
    }
}

pub fn execute(workspace_root: &Path, request: RuntimeRequest) -> RuntimeResponse {
    let invalid_id = request.id.is_empty();
    let id = if invalid_id {
        "unknown".to_string()
    } else {
        request.id
    };
    if request.version != PROTOCOL_VERSION || invalid_id {
        return RuntimeResponse::failure(id, INVALID_REQUEST, "Unsupported runtime request");
    }

    let result = match request.operation {
        RuntimeOperation::ReadFile(params) => read_file(workspace_root, &params.path)
            .map(|content| RuntimeResult::ReadFile(ReadFileResult { content })),
        RuntimeOperation::ListDirectory(params) => list_directory(workspace_root, &params.path)
            .map(|entries| RuntimeResult::ListDirectory(ListDirectoryResult { entries })),
        RuntimeOperation::SearchText(params) => {
            search_text(workspace_root, &params.path, &params.query).map(RuntimeResult::SearchText)
        }
    };
    match result {
        Ok(result) => RuntimeResponse::success(id, result),
        Err(error) => RuntimeResponse::failure(id, error.code, error.message),
    }
}

#[derive(Debug)]
struct RuntimeFailure {
    code: &'static str,
    message: String,
}

fn read_file(workspace_root: &Path, requested_path: &str) -> Result<String, RuntimeFailure> {
    let (_, canonical) = resolve_workspace_path(workspace_root, requested_path)?;
    let metadata = fs::metadata(&canonical)
        .map_err(|error| map_io_error(error, "Could not inspect requested path"))?;
    if !metadata.is_file() {
        return Err(failure(NOT_A_FILE, "Requested path is not a file"));
    }
    if metadata.len() > MAX_FILE_BYTES {
        return Err(failure(
            OUTPUT_LIMIT_EXCEEDED,
            format!("File exceeds the {MAX_FILE_BYTES} byte limit"),
        ));
    }

    let bytes = fs::read(&canonical)
        .map_err(|error| map_io_error(error, "Could not read requested file"))?;
    String::from_utf8(bytes).map_err(|_| failure(INVALID_UTF8, "Requested file is not valid UTF-8"))
}

fn resolve_workspace_path(
    workspace_root: &Path,
    requested_path: &str,
) -> Result<(PathBuf, PathBuf), RuntimeFailure> {
    let relative = Path::new(requested_path);
    if requested_path.is_empty()
        || relative.is_absolute()
        || relative
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err(failure(
            PATH_OUTSIDE_WORKSPACE,
            "Path must be non-empty and workspace-relative",
        ));
    }

    let root = fs::canonicalize(workspace_root)
        .map_err(|error| map_io_error(error, "Could not resolve workspace root"))?;
    let canonical = fs::canonicalize(root.join(relative))
        .map_err(|error| map_io_error(error, "Could not resolve requested path"))?;
    if !canonical.starts_with(&root) {
        return Err(failure(
            PATH_OUTSIDE_WORKSPACE,
            "Resolved path leaves the workspace",
        ));
    }

    Ok((root, canonical))
}

fn list_directory(
    workspace_root: &Path,
    requested_path: &str,
) -> Result<Vec<DirectoryEntry>, RuntimeFailure> {
    let (root, canonical) = resolve_workspace_path(workspace_root, requested_path)?;
    if !canonical.is_dir() {
        return Err(failure(
            NOT_A_DIRECTORY,
            "Requested path is not a directory",
        ));
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(&canonical)
        .map_err(|error| map_io_error(error, "Could not list requested directory"))?
    {
        let entry = entry.map_err(|error| map_io_error(error, "Could not read directory entry"))?;
        let path = entry.path();
        let relative = path.strip_prefix(&root).map_err(|_| {
            failure(
                PATH_OUTSIDE_WORKSPACE,
                "Directory entry leaves the workspace",
            )
        })?;
        if is_discovery_excluded_path(relative) {
            continue;
        }
        let file_type = entry
            .file_type()
            .map_err(|error| map_io_error(error, "Could not inspect directory entry"))?;
        let entry_type = if file_type.is_symlink() {
            DirectoryEntryType::Symlink
        } else if file_type.is_dir() {
            DirectoryEntryType::Directory
        } else if file_type.is_file() {
            DirectoryEntryType::File
        } else {
            continue;
        };
        entries.push(DirectoryEntry {
            path: portable_relative_path(relative),
            entry_type,
        });
        if entries.len() > MAX_DIRECTORY_ENTRIES {
            return Err(failure(
                OUTPUT_LIMIT_EXCEEDED,
                format!("Directory exceeds the {MAX_DIRECTORY_ENTRIES} entry limit"),
            ));
        }
    }
    entries.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(entries)
}

fn search_text(
    workspace_root: &Path,
    requested_path: &str,
    query: &str,
) -> Result<SearchTextResult, RuntimeFailure> {
    if query.is_empty() {
        return Err(failure(INVALID_REQUEST, "Search query must be non-empty"));
    }
    let (root, canonical) = resolve_workspace_path(workspace_root, requested_path)?;
    if !canonical.is_dir() {
        return Err(failure(NOT_A_DIRECTORY, "Search path is not a directory"));
    }
    let mut pending = vec![canonical];
    let mut matches = Vec::new();
    let mut searched_files = 0;
    let mut output_bytes = 0;
    let mut truncated = false;

    while let Some(directory) = pending.pop() {
        let mut children = fs::read_dir(&directory)
            .map_err(|error| map_io_error(error, "Could not search directory"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| map_io_error(error, "Could not read search entry"))?;
        children.sort_by_key(|entry| entry.file_name());
        for entry in children.into_iter().rev() {
            let path = entry.path();
            let relative = path.strip_prefix(&root).map_err(|_| {
                failure(PATH_OUTSIDE_WORKSPACE, "Search entry leaves the workspace")
            })?;
            if is_discovery_excluded_path(relative) {
                continue;
            }
            let file_type = entry
                .file_type()
                .map_err(|error| map_io_error(error, "Could not inspect search entry"))?;
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                pending.push(path);
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            searched_files += 1;
            if searched_files > MAX_SEARCH_FILES {
                truncated = true;
                break;
            }
            let metadata = entry
                .metadata()
                .map_err(|error| map_io_error(error, "Could not inspect search file"))?;
            if metadata.len() > MAX_FILE_BYTES {
                continue;
            }
            let bytes = fs::read(&path)
                .map_err(|error| map_io_error(error, "Could not read search file"))?;
            let Ok(content) = String::from_utf8(bytes) else {
                continue;
            };
            let relative_path = portable_relative_path(relative);
            for (line_index, line) in content.lines().enumerate() {
                let Some(byte_column) = line.find(query) else {
                    continue;
                };
                let preview = match_preview(line, byte_column);
                output_bytes += relative_path.len() + preview.len();
                if matches.len() >= MAX_SEARCH_MATCHES || output_bytes > MAX_SEARCH_OUTPUT_BYTES {
                    truncated = true;
                    break;
                }
                matches.push(SearchTextMatch {
                    path: relative_path.clone(),
                    line: line_index + 1,
                    column: line[..byte_column].chars().count() + 1,
                    preview,
                });
            }
            if truncated {
                break;
            }
        }
        if truncated {
            break;
        }
    }
    matches.sort_by(|left, right| {
        (&left.path, left.line, left.column).cmp(&(&right.path, right.line, right.column))
    });
    Ok(SearchTextResult { matches, truncated })
}

fn portable_relative_path(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn match_preview(line: &str, byte_column: usize) -> String {
    let mut prefix = line[..byte_column]
        .chars()
        .rev()
        .take(200)
        .collect::<Vec<_>>();
    prefix.reverse();
    let remaining = 500 - prefix.len();
    prefix
        .into_iter()
        .chain(line[byte_column..].chars().take(remaining))
        .collect()
}

fn is_sensitive_path(path: &Path) -> bool {
    // Cross-language behavior is locked by schemas/runtime/discovery-policy-fixtures.json.
    let parts = path
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy().to_lowercase()),
            _ => None,
        })
        .collect::<Vec<_>>();
    let basename = parts.last().map(String::as_str).unwrap_or("");
    parts.iter().any(|part| {
        matches!(
            part.as_str(),
            ".aws" | ".azure" | ".git" | ".gnupg" | ".ssh"
        )
    }) || basename.starts_with(".env")
        || matches!(
            basename,
            ".netrc"
                | ".npmrc"
                | ".pypirc"
                | "credentials"
                | "id_dsa"
                | "id_ecdsa"
                | "id_ed25519"
                | "id_rsa"
        )
        || [".key", ".pem", ".p12", ".pfx"]
            .iter()
            .any(|suffix| basename.ends_with(suffix))
}

fn is_discovery_excluded_path(path: &Path) -> bool {
    is_sensitive_path(path)
        || path.components().any(|component| match component {
            Component::Normal(value) => matches!(
                value.to_string_lossy().to_lowercase().as_str(),
                "node_modules" | ".pnpm-store" | "coverage" | "dist" | "target"
            ),
            _ => false,
        })
}

fn failure(code: &'static str, message: impl Into<String>) -> RuntimeFailure {
    RuntimeFailure {
        code,
        message: message.into(),
    }
}

fn map_io_error(error: io::Error, context: &str) -> RuntimeFailure {
    let code = match error.kind() {
        io::ErrorKind::NotFound => NOT_FOUND,
        io::ErrorKind::PermissionDenied => PERMISSION_DENIED,
        _ => INTERNAL_ERROR,
    };
    failure(code, format!("{context}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static FIXTURE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct DiscoveryPolicyFixtures {
        sensitive_paths: Vec<String>,
        ordinary_paths: Vec<String>,
        generated_paths: Vec<String>,
    }

    fn policy_fixtures() -> DiscoveryPolicyFixtures {
        serde_json::from_str(include_str!(
            "../../../schemas/runtime/discovery-policy-fixtures.json"
        ))
        .unwrap()
    }

    fn fixture() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let sequence = FIXTURE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "landache-runtime-{}-{suffix}-{sequence}",
            std::process::id()
        ));
        fs::create_dir(&root).unwrap();
        fs::write(root.join("hello.txt"), "hello").unwrap();
        fs::create_dir(root.join("src")).unwrap();
        fs::write(root.join("src/lib.rs"), "first line\nhello rust\n").unwrap();
        fs::write(root.join(".env.local"), "TOKEN=hello").unwrap();
        fs::create_dir(root.join(".git")).unwrap();
        fs::write(root.join(".git/config"), "hello secret").unwrap();
        fs::create_dir(root.join("node_modules")).unwrap();
        fs::write(root.join("node_modules/dependency.js"), "hello generated").unwrap();
        root
    }

    #[test]
    fn reads_a_workspace_file() {
        let root = fixture();
        assert_eq!(read_file(&root, "hello.txt").unwrap(), "hello");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_parent_traversal() {
        let root = fixture();
        assert_eq!(
            read_file(&root, "../outside.txt").unwrap_err().code,
            "path_outside_workspace"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_an_empty_request_id() {
        let root = fixture();
        let response = execute(
            &root,
            RuntimeRequest {
                version: PROTOCOL_VERSION,
                id: String::new(),
                operation: RuntimeOperation::ReadFile(ReadFileParams {
                    path: "hello.txt".to_string(),
                }),
            },
        );
        assert_eq!(response.id, "unknown");
        assert_eq!(response.error.unwrap().code, "invalid_request");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn deserializes_each_protocol_operation() {
        for (json, expected) in [
            (
                r#"{"version":1,"id":"r1","method":"read_file","params":{"path":"hello.txt"}}"#,
                "read_file",
            ),
            (
                r#"{"version":1,"id":"r2","method":"list_directory","params":{"path":"."}}"#,
                "list_directory",
            ),
            (
                r#"{"version":1,"id":"r3","method":"search_text","params":{"path":".","query":"hello"}}"#,
                "search_text",
            ),
        ] {
            let request: RuntimeRequest = serde_json::from_str(json).unwrap();
            let actual = match request.operation {
                RuntimeOperation::ReadFile(_) => "read_file",
                RuntimeOperation::ListDirectory(_) => "list_directory",
                RuntimeOperation::SearchText(_) => "search_text",
            };
            assert_eq!(actual, expected);
        }
    }

    #[test]
    fn rejects_unknown_top_level_request_fields() {
        let request = r#"{"version":1,"id":"r1","method":"list_directory","params":{"path":"."},"unexpected":true}"#;
        assert!(serde_json::from_str::<RuntimeRequest>(request).is_err());
    }

    #[test]
    fn runtime_methods_match_the_schema() {
        let schema: serde_json::Value = serde_json::from_str(include_str!(
            "../../../schemas/runtime/protocol.schema.json"
        ))
        .unwrap();
        let schema_methods = schema["$defs"]["request"]["properties"]["method"]["enum"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(schema_methods, RUNTIME_METHODS);
    }

    #[test]
    fn discovery_policy_matches_the_shared_fixtures() {
        let fixtures = policy_fixtures();
        for path in fixtures.sensitive_paths {
            assert!(is_sensitive_path(Path::new(&path)), "{path}");
            assert!(is_discovery_excluded_path(Path::new(&path)), "{path}");
        }
        for path in fixtures.ordinary_paths {
            assert!(!is_sensitive_path(Path::new(&path)), "{path}");
            assert!(!is_discovery_excluded_path(Path::new(&path)), "{path}");
        }
        for path in fixtures.generated_paths {
            assert!(!is_sensitive_path(Path::new(&path)), "{path}");
            assert!(is_discovery_excluded_path(Path::new(&path)), "{path}");
        }
    }

    #[test]
    fn runtime_error_codes_match_the_schema() {
        let schema: serde_json::Value = serde_json::from_str(include_str!(
            "../../../schemas/runtime/protocol.schema.json"
        ))
        .unwrap();
        let schema_codes: Vec<&str> =
            schema["$defs"]["response"]["properties"]["error"]["properties"]["code"]["enum"]
                .as_array()
                .unwrap()
                .iter()
                .map(|value| value.as_str().unwrap())
                .collect();
        assert_eq!(schema_codes, RUNTIME_ERROR_CODES);
    }

    #[test]
    fn rejects_files_over_the_output_limit() {
        let root = fixture();
        fs::write(
            root.join("large.txt"),
            vec![b'x'; MAX_FILE_BYTES as usize + 1],
        )
        .unwrap();
        assert_eq!(
            read_file(&root, "large.txt").unwrap_err().code,
            OUTPUT_LIMIT_EXCEEDED
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn lists_one_directory_in_stable_order_without_sensitive_entries() {
        let root = fixture();
        let entries = list_directory(&root, ".").unwrap();
        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.path.as_str())
                .collect::<Vec<_>>(),
            vec!["hello.txt", "src"]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn searches_utf8_files_without_reading_sensitive_paths() {
        let root = fixture();
        let result = search_text(&root, ".", "hello").unwrap();
        assert!(!result.truncated);
        assert_eq!(result.matches.len(), 2);
        assert_eq!(result.matches[0].path, "hello.txt");
        assert_eq!(result.matches[0].line, 1);
        assert_eq!(result.matches[0].column, 1);
        assert_eq!(result.matches[1].path, "src/lib.rs");
        assert_eq!(result.matches[1].line, 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_search_outside_the_workspace_and_empty_queries() {
        let root = fixture();
        assert_eq!(
            search_text(&root, "../outside", "hello").unwrap_err().code,
            PATH_OUTSIDE_WORKSPACE
        );
        assert_eq!(
            search_text(&root, ".", "").unwrap_err().code,
            INVALID_REQUEST
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reports_truncated_search_results_at_the_match_limit() {
        let root = fixture();
        fs::write(
            root.join("many.txt"),
            "hello\n".repeat(MAX_SEARCH_MATCHES + 1),
        )
        .unwrap();
        let result = search_text(&root, ".", "hello").unwrap();
        assert!(result.truncated);
        assert_eq!(result.matches.len(), MAX_SEARCH_MATCHES);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn search_preview_contains_a_match_after_a_long_prefix() {
        let root = fixture();
        fs::write(
            root.join("wide.txt"),
            format!("{}needle suffix", "x".repeat(600)),
        )
        .unwrap();
        let result = search_text(&root, ".", "needle").unwrap();
        let matched = result
            .matches
            .iter()
            .find(|matched| matched.path == "wide.txt")
            .unwrap();
        assert_eq!(matched.column, 601);
        assert!(matched.preview.contains("needle"));
        assert!(matched.preview.chars().count() <= 500);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_directories_over_the_entry_limit() {
        let root = fixture();
        let crowded = root.join("crowded");
        fs::create_dir(&crowded).unwrap();
        for index in 0..=MAX_DIRECTORY_ENTRIES {
            fs::write(crowded.join(format!("{index:04}.txt")), "x").unwrap();
        }
        assert_eq!(
            list_directory(&root, "crowded").unwrap_err().code,
            OUTPUT_LIMIT_EXCEEDED
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlink_that_escapes_the_workspace() {
        use std::os::unix::fs::symlink;

        let root = fixture();
        let outside = root.with_extension("outside.txt");
        fs::write(&outside, "secret").unwrap();
        symlink(&outside, root.join("escape.txt")).unwrap();
        assert_eq!(
            read_file(&root, "escape.txt").unwrap_err().code,
            PATH_OUTSIDE_WORKSPACE
        );
        fs::remove_dir_all(root).unwrap();
        fs::remove_file(outside).unwrap();
    }
}
