# SageSearch — AI File Finder & Autonomous Agent

> Find local files using natural language and automate multi-step file workflows with Google Gemini. Privacy-first and local-friendly.

---

## ⚡ Dual-Lane Experience

SageSearch offers two distinct interaction modes:

1. **Lane 1: Direct Search** — Instant natural language file search across your computer (Documents, Downloads, Desktop, etc.).
2. **Lane 2: Agent Mode (Taskmaster)** — Autonomous multi-step file workflow agent powered by Google Gemini that finds files, extracts structured data from contents, requests human approval, and generates CSV/Markdown artifacts directly on your machine.

---

## 🚀 Quick Start

### 1. Setup Demo Receipts
```bash
python demo_setup.py
```

### 2. Start SageSearch
Double-click **`Start SageSearch.bat`** (or run `npm start` in `backend/`).  
Your browser will open automatically at `http://localhost:3001`.

---

## 🛠️ Architecture

```
User's PC (Desktop App & Node.js Backend)
  ├─ Direct Search (Local SQLite Index)
  ├─ Local Tools (search_files, read_file_content, create_artifact)
  └─ WebSocket Bridge Client (ws://localhost:8080/ws/bridge)
          ▲
          │ Bidirectional WSS
          ▼
Cloud Agent Service (Google Cloud Run / FastAPI)
  ├─ Google GenAI Engine (Gemini 3.5 / 2.5 Flash)
  ├─ Multi-Step Task Planner & Executor
  └─ Google Cloud Firestore (Task State & User Memory)
```

---

## 📋 Taskmaster Workflows Supported

| Workflow Recipe | What It Does | Output Artifact |
| :--- | :--- | :--- |
| **Receipts to Expense Report** | Finds gym & travel receipts, extracts merchants and totals, computes category sums | `expense_report_july_2026.csv` |
| **Project Specs Summary** | Finds recent project requirements documents and compiles an itemized overview | `project_summary.md` |
| **Invoices & Payment Schedule** | Scans contractor invoices, extracts folio numbers and balance due | `payment_schedule.csv` |

---

## 🔒 Privacy Guarantee

- **Files Stay on Your Machine**: SageSearch indexes file metadata and reads document text locally.
- **Zero Cloud Storage of Files**: Raw documents are never uploaded to cloud buckets. Only requested text snippets are processed by Gemini function calls.
- **Human in the Loop**: The agent presents an itemized preview table before generating final artifacts.

---

## 🧪 Testing & Verification

```bash
# Python Agent Test Suite (19 tests)
cd agent-service
python -m pytest tests -v

# Node.js Desktop Backend Test Suite (10 tests)
cd backend
npm test
```

---

## ☁️ Google Cloud Deployment

To deploy the Agent Service to Google Cloud Run:
```powershell
$env:GEMINI_API_KEY = "AIzaSy..."
cd agent-service
.\deploy.ps1 -Project "your-gcp-project-id" -Region "us-west4"
```
