import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import dotenv from "dotenv";
import { processPoint, MatchState } from "./src/scoring.js";

// Load environment variables from .env if present
dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Firebase Initialization
const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};

// Check if critical Firebase env variables are set
if (!process.env.VITE_FIREBASE_API_KEY || !process.env.VITE_FIREBASE_PROJECT_ID) {
  console.warn("WARNING: Firebase environment variables are missing from process.env. The API routes might fail to contact Firestore.");
}

const authDomainVal = process.env.VITE_FIREBASE_AUTH_DOMAIN || '';
if (authDomainVal.toLowerCase().startsWith('aiza')) {
  console.error("CRITICAL CONFIGURATION ERROR: VITE_FIREBASE_AUTH_DOMAIN is configured with an API Key (starts with AIza...) instead of a valid auth domain (like project.firebaseapp.com). Please fix your environment variables!");
} else if (authDomainVal && !authDomainVal.includes('.')) {
  console.warn(`WARNING: VITE_FIREBASE_AUTH_DOMAIN value ("${authDomainVal}") does not appear to be a valid domain.`);
}

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp, process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID);

// helper: fetch current match doc from Firestore
async function getMatch(code: string): Promise<MatchState | null> {
  const docRef = doc(db, 'matches', code);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) return null;
  return docSnap.data() as MatchState;
}

// helper: save updated match doc to Firestore
async function saveMatch(code: string, state: MatchState) {
  const docRef = doc(db, 'matches', code);
  await setDoc(docRef, {
    ...state,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// API Route: Check Server Health
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Padel scoreboard backend server is running!" });
});

// API Route: Send score point from ESP32 or external source
// Example: GET /api/match/5379/point?team=0
app.get("/api/match/:code/point", async (req, res) => {
  const { code } = req.params;
  const teamQ = req.query.team;

  if (teamQ === undefined || (teamQ !== "0" && teamQ !== "1")) {
    return res.status(400).json({ error: "Missing or invalid 'team' parameter. Must be 0 or 1." });
  }

  const teamIndex = parseInt(teamQ, 10) as 0 | 1;

  try {
    const currentMatch = await getMatch(code);
    if (!currentMatch) {
      return res.status(404).json({ error: `Match with code ${code} not found.` });
    }

    if (currentMatch.isGameOver) {
      return res.status(400).json({ error: "Match already finished.", data: currentMatch });
    }

    // Capture state before this point for undo history
    const { undoStack, ...stateToSave } = currentMatch;
    const currentUndoStack = Array.isArray(undoStack) ? [...undoStack] : [];
    
    // Add to stack, keep only last 10 entries for performance
    currentUndoStack.push(stateToSave);
    if (currentUndoStack.length > 10) {
      currentUndoStack.shift();
    }

    // Call shared scoring processor
    const nextState = processPoint({
      ...currentMatch,
      undoStack: currentUndoStack,
    }, teamIndex);

    await saveMatch(code, nextState);
    return res.json({ success: true, message: `Point scored for Team ${teamIndex}`, currentPoint: nextState.points, data: nextState });

  } catch (error: any) {
    console.error("API error adding point:", error);
    return res.status(500).json({ error: "Failed to update match scoring.", details: error.message });
  }
});

// API Route: Undo last action
// Example: GET /api/match/5379/undo
app.get("/api/match/:code/undo", async (req, res) => {
  const { code } = req.params;

  try {
    const currentMatch = await getMatch(code);
    if (!currentMatch) {
      return res.status(404).json({ error: `Match with code ${code} not found.` });
    }

    const { undoStack } = currentMatch;
    if (!undoStack || !Array.isArray(undoStack) || undoStack.length === 0) {
      return res.status(400).json({ error: "No undo history available for this match." });
    }

    // Pop the last state
    const nextUndoStack = [...undoStack];
    const previousState = nextUndoStack.pop() as MatchState;
    previousState.undoStack = nextUndoStack; // set the new stack

    await saveMatch(code, previousState);
    return res.json({ success: true, message: "Undo completed successfully", currentPoint: previousState.points, data: previousState });

  } catch (error: any) {
    console.error("API error on undo:", error);
    return res.status(500).json({ error: "Failed to perform undo operation.", details: error.message });
  }
});

// API Route: Reset Match score
// Example: GET /api/match/5379/reset
app.get("/api/match/:code/reset", async (req, res) => {
  const { code } = req.params;

  try {
    const currentMatch = await getMatch(code);
    if (!currentMatch) {
      return res.status(404).json({ error: `Match with code ${code} not found.` });
    }

    const resetState: MatchState = {
      ...currentMatch,
      points: [0, 0],
      games: [0, 0],
      sets: [0, 0],
      setHistory: [],
      server: 0,
      isGameOver: false,
      winner: null,
      undoStack: []
    };

    await saveMatch(code, resetState);
    return res.json({ success: true, message: "Match score was fully reset.", data: resetState });

  } catch (error: any) {
    console.error("API error resetting match:", error);
    return res.status(500).json({ error: "Failed to reset match score.", details: error.message });
  }
});

// Start server and config Vite middleware for dev runtime
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
