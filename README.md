# K2Hackathon

Upload a research paper + dataset, and K2 tells you if the results are reproducible.

---

## Setup

### Step 1 — Install uv

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Close and reopen your terminal after this.

---

### Step 2 — Clone the repo

```bash
git clone https://github.com/WinnieHsu0111/K2Hackathon.git
```

```bash
cd K2Hackathon
```

---

### Step 3 — Install backend dependencies

```bash
cd backend
```

```bash
uv sync
```

---

### Step 4 — Create your `.env` file

Inside the `backend/` folder, create a file called `.env` (ask Winnie for the API key):

```
K2_API_KEY=IFM-xf...
K2_BASE_URL=https://api.ifm.ai/v1
K2_MODEL=IFM/K2-Horizon-375B-A23B
```

---

### Step 5 — Install frontend dependencies

```bash
cd ../frontend
```

```bash
npm install
```

---

## Run

You need **two terminal windows open at the same time.**

**Terminal 1 — backend:**

```bash
cd backend
```

```bash
uv run python -m uvicorn main:app --reload
```

Wait until you see `Uvicorn running on http://127.0.0.1:8000`. Keep this terminal open.

**Terminal 2 — frontend:**

```bash
cd frontend
```

```bash
npm run dev
```

Wait until you see `Local: http://localhost:3000`. Keep this terminal open.

**Then open [http://localhost:3000](http://localhost:3000) in your browser.**

Both terminals must stay running while you use the app.
