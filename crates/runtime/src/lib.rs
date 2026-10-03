//! Trusted local execution boundary for Landache.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Component, Path};

pub const PROTOCOL_VERSION: u8 = 1;
pub const MAX_FILE_BYTES: u64 = 1024 * 1024;
pub const RUNTIME_ERROR_CODES: [&str; 8] = [
    INVALID_REQUEST,
    PATH_OUTSIDE_WORKSPACE,
    NOT_FOUND,
    NOT_A_FILE,
    PERMISSION_DENIED,
    OUTPUT_LIMIT_EXCEEDED,
    INVALID_UTF8,
    INTERNAL_ERROR,
];
const INVALID_REQUEST: &str = "invalid_request";
const PATH_OUTSIDE_WORKSPACE: &str = "path_outside_workspace";
const NOT_FOUND: &str = "not_found";
const NOT_A_FILE: &str = "not_a_file";
const PERMISSION_DENIED: &str = "permission_denied";
const OUTPUT_LIMIT_EXCEEDED: &str = "output_limit_exceeded";
const INVALID_UTF8: &str = "invalid_utf8";
const INTERNAL_ERROR: &str = "internal_error";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeRequest {
    pub version: u8,
    pub id: String,
    pub method: String,
    pub params: ReadFileParams,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReadFileParams {
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct RuntimeResponse {
    pub version: u8,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<ReadFileResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RuntimeError>,
}

#[derive(Debug, Serialize)]
pub struct ReadFileResult {
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct RuntimeError {
    pub code: &'static str,
    pub message: String,
}

impl RuntimeResponse {
    pub fn success(id: String, content: String) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            id,
            result: Some(ReadFileResult { content }),
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
    if request.version != PROTOCOL_VERSION || invalid_id || request.method != "read_file" {
        return RuntimeResponse::failure(id, INVALID_REQUEST, "Unsupported runtime request");
    }

    match read_file(workspace_root, &request.params.path) {
        Ok(content) => RuntimeResponse::success(id, content),
        Err(error) => RuntimeResponse::failure(id, error.code, error.message),
    }
}

#[derive(Debug)]
struct ReadFailure {
    code: &'static str,
    message: String,
}

fn read_file(workspace_root: &Path, requested_path: &str) -> Result<String, ReadFailure> {
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

fn failure(code: &'static str, message: impl Into<String>) -> ReadFailure {
    ReadFailure {
        code,
        message: message.into(),
    }
}

fn map_io_error(error: io::Error, context: &str) -> ReadFailure {
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
                method: "read_file".to_string(),
                params: ReadFileParams {
                    path: "hello.txt".to_string(),
                },
            },
        );
        assert_eq!(response.id, "unknown");
        assert_eq!(response.error.unwrap().code, "invalid_request");
        fs::remove_dir_all(root).unwrap();
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
