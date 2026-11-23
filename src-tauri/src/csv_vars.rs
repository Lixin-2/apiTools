/// 轻量 CSV 解析：支持逗号分隔、双引号包裹、引号内逗号与 "" 转义
fn parse_line(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();

    while let Some(ch) = chars.next() {
        match ch {
            '"' if in_quotes => {
                if chars.peek() == Some(&'"') {
                    current.push('"');
                    chars.next();
                } else {
                    in_quotes = false;
                }
            }
            '"' => in_quotes = true,
            ',' if !in_quotes => {
                fields.push(current.trim().to_string());
                current = String::new();
            }
            _ => current.push(ch),
        }
    }
    fields.push(current.trim().to_string());
    fields
}

/// 返回 (表头, 数据行)；表头空列会被保留占位，数据行与表头对齐
pub fn parse(content: &str) -> (Vec<String>, Vec<Vec<String>>) {
    let text = content.strip_prefix('\u{feff}').unwrap_or(content);
    let mut lines = text
        .lines()
        .map(|line| line.trim_end_matches('\r'))
        .filter(|line| !line.trim().is_empty());

    let Some(header_line) = lines.next() else {
        return (Vec::new(), Vec::new());
    };
    let headers: Vec<String> = parse_line(header_line)
        .into_iter()
        .map(|name| name.trim().to_string())
        .collect();

    let mut rows = Vec::new();
    for line in lines {
        let fields = parse_line(line);
        if fields.iter().all(|field| field.is_empty()) {
            continue;
        }
        let mut row = fields;
        row.resize(headers.len(), String::new());
        rows.push(row);
    }
    (headers, rows)
}

pub fn load(path: &str) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("读取 CSV 失败: {e}"))?;
    let text = String::from_utf8(bytes).map_err(|_| "CSV 需要是 UTF-8 编码".to_string())?;
    let (headers, rows) = parse(&text);
    if headers.is_empty() {
        return Err("CSV 缺少表头行".to_string());
    }
    if rows.is_empty() {
        return Err("CSV 只有表头，没有数据行".to_string());
    }
    if rows.len() > 200_000 {
        return Err("CSV 行数超过 20 万，请拆分后再压测".to_string());
    }
    Ok((headers, rows))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_quoted_fields() {
        let (headers, rows) = parse("userId,token\n1,\"a,b\"\n2,\"he said \"\"hi\"\"\"\n");
        assert_eq!(headers, vec!["userId", "token"]);
        assert_eq!(rows[0], vec!["1", "a,b"]);
        assert_eq!(rows[1], vec!["2", "he said \"hi\""]);
    }

    #[test]
    fn pads_short_rows() {
        let (_, rows) = parse("a,b,c\n1,2\n");
        assert_eq!(rows[0], vec!["1", "2", ""]);
    }
}
