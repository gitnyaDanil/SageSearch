"""Multi-format artifact generation (CSV, Markdown, JSON) for SageSearch Agent."""
import csv
import io
import json
from typing import Any, Dict, List, Optional


def _safe_float(val: Any) -> float:
    if isinstance(val, (int, float)):
        return float(val)
    if not val:
        return 0.0
    s = str(val).replace("$", "").replace(",", "").strip()
    # If ends with USD or other currency word, take first part
    parts = s.split()
    if parts:
        s = parts[0]
    try:
        return float(s)
    except Exception:
        return 0.0


class ArtifactBuilder:
    """Builds clean, structured output files from extracted workflow data."""

    @staticmethod
    def build_expense_csv(rows: List[Dict[str, Any]], summary: Optional[Dict[str, Any]] = None) -> str:
        """Generates an RFC 4180-compliant CSV string for an expense report."""
        output = io.StringIO()
        writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)

        # Header
        headers = ["Merchant", "Date", "Category", "Amount ($)", "Currency", "Invoice #", "Source File"]
        writer.writerow(headers)

        total_amount = 0.0

        for r in rows:
            amount = _safe_float(r.get("amount", 0.0))
            total_amount += amount
            writer.writerow([
                r.get("merchant", "Unknown"),
                r.get("date", ""),
                r.get("category", "Other"),
                f"{amount:.2f}",
                r.get("currency", "USD"),
                r.get("invoice_number", "") or "",
                r.get("file", "") or r.get("source_file", "")
            ])

        # Summary footer row
        writer.writerow([])
        writer.writerow(["TOTAL", "", "", f"{total_amount:.2f}", "USD", f"{len(rows)} items", ""])

        return output.getvalue()

    @staticmethod
    def build_expense_markdown(rows: List[Dict[str, Any]], summary: Optional[Dict[str, Any]] = None) -> str:
        """Generates a rich Markdown expense report with category breakdowns."""
        total_amount = sum(_safe_float(r.get("amount", 0.0)) for r in rows)
        
        # Calculate category breakdown
        category_totals: Dict[str, float] = {}
        for r in rows:
            cat = r.get("category", "Other")
            category_totals[cat] = category_totals.get(cat, 0.0) + _safe_float(r.get("amount", 0.0))

        lines = [
            "# Expense Report Summary",
            "",
            f"**Total Expenses**: ${total_amount:.2f}  ",
            f"**Total Receipts Processed**: {len(rows)}  ",
            "",
            "## Category Breakdown",
            ""
        ]

        for cat, cat_total in sorted(category_totals.items(), key=lambda x: x[1], reverse=True):
            pct = (cat_total / total_amount * 100) if total_amount > 0 else 0
            lines.append(f"- **{cat}**: ${cat_total:.2f} ({pct:.1f}%)")

        lines.extend([
            "",
            "## Itemized Receipts Table",
            "",
            "| Merchant | Date | Category | Amount ($) | Source File |",
            "| :--- | :--- | :--- | :--- | :--- |"
        ])

        for r in rows:
            amt = _safe_float(r.get("amount", 0.0))
            lines.append(
                f"| {r.get('merchant', 'Unknown')} | {r.get('date', '')} | {r.get('category', 'Other')} | "
                f"${amt:.2f} | `{r.get('file', '')}` |"
            )

        lines.append("")
        lines.append(f"> *Generated autonomously by SageSearch-Agent*")

        return "\n".join(lines)

    @staticmethod
    def build_expense_json(rows: List[Dict[str, Any]], summary: Optional[Dict[str, Any]] = None) -> str:
        """Generates structured JSON export."""
        total_amount = sum(_safe_float(r.get("amount", 0.0)) for r in rows)
        payload = {
            "metadata": {
                "generator": "SageSearch-Agent",
                "item_count": len(rows),
                "total_expense": round(total_amount, 2),
                "currency": "USD"
            },
            "items": rows
        }
        return json.dumps(payload, indent=2)

    @staticmethod
    def build_generic_csv(columns: List[str], rows: List[List[Any]], summary: Optional[Dict[str, Any]] = None) -> str:
        """Generates an RFC 4180-compliant CSV string for arbitrary columns and rows."""
        output = io.StringIO()
        writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)
        writer.writerow(columns)
        for row in rows:
            writer.writerow(row)
        if summary:
            writer.writerow([])
            summary_row = [f"Summary: {k}={v}" for k, v in summary.items()]
            writer.writerow(summary_row)
        return output.getvalue()

    @staticmethod
    def build_generic_markdown(title: str, columns: List[str], rows: List[List[Any]], summary: Optional[Dict[str, Any]] = None) -> str:
        """Generates a Markdown document with a table for arbitrary columns and rows."""
        lines = [f"# {title}", ""]
        if summary:
            lines.append("## Summary")
            for k, v in summary.items():
                lines.append(f"- **{k.replace('_', ' ').title()}**: {v}")
            lines.append("")

        lines.append("## Details")
        lines.append("")
        lines.append("| " + " | ".join(columns) + " |")
        lines.append("| " + " | ".join([":---" for _ in columns]) + " |")
        for row in rows:
            lines.append("| " + " | ".join([str(cell).replace("|", "\\|") for cell in row]) + " |")

        lines.append("")
        lines.append("> *Generated autonomously by SageSearch-Agent*")
        return "\n".join(lines)

