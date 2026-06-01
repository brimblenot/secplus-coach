# Security+ SY0-701 Coach

AI-powered study app with persistent progress tracking. No native build tools required.

## Quick Start

### 1. Install
```
npm install
```

### 2. Add API key
Edit `.env.local` — replace `your_api_key_here` with your key from https://console.anthropic.com

### 3. Add transcripts
Create a `transcripts` folder and copy all Professor Messer `.txt` files into it.
File names must start with the topic number, e.g. `003-The_CIA_Triad_...en.txt`

### 4. Initialize database
```
npm run db:init
```

### 5. Run
```
npm run dev
```
Open http://localhost:3000

## Architecture

- **sql.js** — pure JavaScript SQLite, no native compilation needed
- **Next.js 15** — app router + API routes
- **Anthropic SDK** — Claude generates study guides (streamed) and quizzes
- All your study rules are in `lib/prompts.ts` — edit anytime

## Data stored in `data/coach.db`
- Topic progress & scores
- Full quiz history  
- Weak areas (auto-detected from wrong answers)
- Session log
