use apitools_core::{mcp, store};
use std::io::{self, BufRead, Write};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut index = 1;
    while index < args.len() {
        if args[index] == "--data-dir" && index + 1 < args.len() {
            std::env::set_var("APITOOLS_DATA_DIR", &args[index + 1]);
            index += 2;
            continue;
        }
        index += 1;
    }

    let stdin = io::stdin();
    let mut stdout = io::stdout();
    eprintln!(
        "[apitools-mcp] ready (rust, stdio). data dir: {}",
        store::data_dir().to_string_lossy()
    );

    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(message) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        if let Some(response) = mcp::handle_message(&message) {
            if writeln!(stdout, "{response}").is_err() {
                break;
            }
            let _ = stdout.flush();
        }
    }
}
