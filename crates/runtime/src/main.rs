use landache_runtime::{RuntimeRequest, RuntimeResponse};
use std::io::{self, BufRead};
use std::path::PathBuf;

fn main() {
    let mut args = std::env::args().skip(1);
    let workspace_root = match (args.next().as_deref(), args.next()) {
        (Some("--workspace"), Some(path)) if args.next().is_none() => PathBuf::from(path),
        _ => {
            eprintln!("usage: landache-runtime --workspace <path>");
            std::process::exit(2);
        }
    };

    let mut line = String::new();
    if let Err(error) = io::stdin().lock().read_line(&mut line) {
        eprintln!("failed to read request: {error}");
        std::process::exit(1);
    }

    let response = match serde_json::from_str::<RuntimeRequest>(&line) {
        Ok(request) => landache_runtime::execute(&workspace_root, request),
        Err(error) => RuntimeResponse::failure(
            "unknown".to_string(),
            "invalid_request",
            format!("Invalid request JSON: {error}"),
        ),
    };

    match serde_json::to_string(&response) {
        Ok(json) => println!("{json}"),
        Err(error) => {
            eprintln!("failed to encode response: {error}");
            std::process::exit(1);
        }
    }
}
