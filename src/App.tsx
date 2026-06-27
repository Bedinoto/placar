/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RotateCcw, Undo2, Settings, Trophy, X, Check, History, Calendar, Waves, Zap, LogIn, Share2, Users, Camera, Trash2, Plus, QrCode, Mic, MicOff } from 'lucide-react';
import confetti from 'canvas-confetti';
import QRCode from 'qrcode';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { 
  signInWithPopup, 
  signInWithRedirect,
  signInAnonymously,
  signOut,
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { doc, setDoc, onSnapshot, getDoc, serverTimestamp, arrayUnion } from 'firebase/firestore';
import { 
  type Score, 
  type SetScore, 
  type MatchState, 
  processPoint, 
  getPointCount 
} from './scoring';

interface FinishedMatch {
  id: string;
  date: string;
  teamNames: [string, string];
  sets: [number, number];
  setHistory: SetScore[];
  winner: 0 | 1;
}

const POINT_SEQUENCE: Score[] = [0, 15, 30, 40];

export default function App() {
  const [state, setState] = useState<MatchState>({
    points: [0, 0],
    games: [0, 0],
    sets: [0, 0],
    setHistory: [],
    server: 0,
    serverPlayer: 2,
    isGameOver: false,
    winner: null,
    gameMode: 'padel',
    bestOf: 3,
    goldenPoint: true,
    teamNames: ['TIME 1', 'TIME 2'],
  });

  const [isModeSelected, setIsModeSelected] = useState(false);
  const [history, setHistory] = useState<MatchState[]>([]);
  const [finishedMatches, setFinishedMatches] = useState<FinishedMatch[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [goldenPoint, setGoldenPoint] = useState(true);
  const [bestOf, setBestOf] = useState(3);
  const [teamNames, setTeamNames] = useState<[string, string]>(['TIME 1', 'TIME 2']);
  const [playerPhotos, setPlayerPhotos] = useState<Record<string, string>>({
    t0p1: '',
    t0p2: '',
    t1p1: '',
    t1p2: '',
  });
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({
    t0p1: '',
    t0p2: '',
    t1p1: '',
    t1p2: '',
  });
  const [user, setUser] = useState<User | null>(null);
  const [matchCode, setMatchCode] = useState<string | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [envErrors, setEnvErrors] = useState<string[]>([]);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isControllerMode, setIsControllerMode] = useState(false);
  const [copiedCtrlLink, setCopiedCtrlLink] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [ctrlQrCode, setCtrlQrCode] = useState<string>('');
  const [showCtrlQr, setShowCtrlQr] = useState<boolean>(true);

  // Voice Command States
  const [isListening, setIsListening] = useState(false);
  const [voiceNotification, setVoiceNotification] = useState<string | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const isListeningRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const voiceTimeoutRef = useRef<any>(null);

  const handlePointRef = useRef<any>(null);

  const showVoiceNotification = (message: string) => {
    if (voiceTimeoutRef.current) {
      clearTimeout(voiceTimeoutRef.current);
    }
    setVoiceNotification(message);
    voiceTimeoutRef.current = setTimeout(() => {
      setVoiceNotification(null);
    }, 2500);
  };

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceSupported(false);
    }
    return () => {
      if (voiceTimeoutRef.current) clearTimeout(voiceTimeoutRef.current);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {}
      }
    };
  }, []);

  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Seu navegador não suporta reconhecimento de voz. Tente usar o Google Chrome ou Microsoft Edge.");
      return;
    }

    try {
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = false;
      rec.lang = 'pt-BR';

      rec.onstart = () => {
        setIsListening(true);
        isListeningRef.current = true;
      };

      rec.onresult = (event: any) => {
        const lastResultIndex = event.results.length - 1;
        const text = event.results[lastResultIndex][0].transcript.toLowerCase().trim();
        console.log("Comando de voz detectado:", text);

        // check commands
        if (text.includes('verde') || text.includes('ponto verde') || text.includes('time verde') || text.includes('pontuar verde') || text.includes('marcar verde')) {
          if (handlePointRef.current) {
            handlePointRef.current(0);
            showVoiceNotification("Ponto para o Time Verde! 🟢");
          }
        } else if (text.includes('azul') || text.includes('ponto azul') || text.includes('time azul') || text.includes('pontuar azul') || text.includes('marcar azul')) {
          if (handlePointRef.current) {
            handlePointRef.current(1);
            showVoiceNotification("Ponto para o Time Azul! 🔵");
          }
        }
      };

      rec.onerror = (event: any) => {
        console.error("Erro no reconhecimento de voz:", event.error);
        if (event.error === 'not-allowed') {
          alert("Permissão para usar o microfone foi negada. Por favor, ative a permissão de microfone nas configurações do seu navegador para usar os comandos de voz.");
          stopListening();
        }
      };

      rec.onend = () => {
        // Auto-restart if we are supposed to be listening
        if (isListeningRef.current) {
          try {
            recognitionRef.current?.start();
          } catch (e) {
            console.error("Erro ao reiniciar o reconhecimento de voz:", e);
          }
        }
      };

      recognitionRef.current = rec;
      isListeningRef.current = true;
      setIsListening(true);
      rec.start();
    } catch (err) {
      console.error("Erro ao iniciar o reconhecimento de voz:", err);
    }
  };

  const stopListening = () => {
    isListeningRef.current = false;
    setIsListening(false);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        console.error("Erro ao parar o reconhecimento de voz:", e);
      }
    }
  };

  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  // Generate QR Code for the Remote control
  useEffect(() => {
    if (matchCode) {
      const url = `${window.location.origin}/${matchCode}/control`;
      QRCode.toDataURL(url, {
        margin: 2,
        width: 250,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      })
      .then(url => {
        setCtrlQrCode(url);
      })
      .catch(err => {
        console.error('Error generating QR Code:', err);
      });
    }
  }, [matchCode]);

  // Auto-join from URL path on load (e.g. /1234 or /1234/control)
  useEffect(() => {
    if (!isAuthReady) return;

    const path = window.location.pathname;
    const matchScoreboard = path.match(/^\/([0-9]{4})$/);
    const matchController = path.match(/^\/([0-9]{4})\/(control|configurar|c)$/);
    const hasMatch = matchScoreboard || matchController;

    if (hasMatch) {
      const urlCode = matchScoreboard ? matchScoreboard[1] : (matchController ? matchController[1] : '');
      if (matchController) {
        setIsControllerMode(true);
      }

      const joinFromUrl = async () => {
        let currentUser = user;
        if (!currentUser) {
          try {
            // Se não houver usuário logado, loga como visitante de forma totalmente silenciosa
            const credential = await signInAnonymously(auth);
            currentUser = credential.user;
          } catch (error) {
            console.error("Error signing in anonymously for URL match:", error);
            setLoginError("Erro ao acessar visitante para carregar o link da TV. Tente entrar manualmente.");
            return;
          }
        }

        try {
          const docRef = doc(db, 'matches', urlCode);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            setMatchCode(urlCode);
            setIsModeSelected(true);
          } else {
            alert(`Partida com código ${urlCode} não foi encontrada.`);
            window.history.pushState({}, '', '/');
          }
        } catch (error) {
          console.error("Error loading match from URL:", error);
          setLoginError("Não foi possível carregar a partida do link da TV. Verifique sua conexão.");
        }
      };

      joinFromUrl();
    }
  }, [isAuthReady, user]);

  // Verificação automática de variáveis de ambiente configuradas incorretamente
  useEffect(() => {
    const tempErrors: string[] = [];
    const apiKey = import.meta.env.VITE_FIREBASE_API_KEY || '';
    const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '';
    const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || '';

    if (authDomain && (authDomain.toLowerCase().startsWith('aiza'))) {
      tempErrors.push('O campo "VITE_FIREBASE_AUTH_DOMAIN" está configurado incorretamente com a sua Chave de API (que começa com "AIza..."). O valor correto deveria ser o domínio de autenticação, que geralmente tem o formato "[id-do-projeto].firebaseapp.com".');
    } else if (authDomain && !authDomain.includes('.')) {
      tempErrors.push(`O domínio de autenticação "${authDomain}" configurado em "VITE_FIREBASE_AUTH_DOMAIN" parece ser inválido. Ele deve conter ponto, normalmente terminando em ".firebaseapp.com".`);
    }

    if (projectId && (projectId.toLowerCase().startsWith('aiza'))) {
      tempErrors.push('O campo "VITE_FIREBASE_PROJECT_ID" está configurado incorretamente com a sua Chave de API (que começa com "AIza..."). Ele deveria ser o ID curto do seu projeto Firebase Console, por exemplo, "placar-padel-1234".');
    }

    setEnvErrors(tempErrors);
  }, []);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Firestore Sync Listener - The Single Source of Truth
  useEffect(() => {
    if (!matchCode || !user) return;

    const unsubscribe = onSnapshot(doc(db, 'matches', matchCode), (snapshot) => {
      // Ignore updates that originated locally to prevent loops and UI flickering
      // This ensures we only react to changes from OTHER devices
      if (snapshot.metadata.hasPendingWrites) return;

      if (snapshot.exists()) {
        const data = snapshot.data();
        
        // Update all state from the database snapshot
        setState((current) => {
          // If the match game over transitioned to true, trigger confetti!
          if (data.isGameOver && !current.isGameOver) {
            confetti({
              particleCount: 150,
              spread: 70,
              origin: { y: 0.6 },
              colors: data.gameMode === 'padel' ? ['#00FF00', '#FFFFFF', '#000000'] : ['#FF6B00', '#FFFFFF', '#000000']
            });
          }
          return {
            points: data.points,
            games: data.games,
            sets: data.sets,
            setHistory: data.setHistory || [],
            server: data.server,
            serverPlayer: data.serverPlayer,
            isGameOver: data.isGameOver,
            winner: data.winner ?? null,
            gameMode: data.gameMode,
            createdByEmail: data.createdByEmail,
            createdById: data.createdById,
            undoStack: data.undoStack || [],
          };
        });
        setTeamNames(data.teamNames);
        setBestOf(data.bestOf);
        setGoldenPoint(data.goldenPoint);
        if (data.playerPhotos) {
          setPlayerPhotos(data.playerPhotos);
        } else {
          setPlayerPhotos({
            t0p1: '',
            t0p2: '',
            t1p1: '',
            t1p2: '',
          });
        }
        if (data.playerNames) {
          setPlayerNames(data.playerNames);
        } else {
          setPlayerNames({
            t0p1: '',
            t0p2: '',
            t1p1: '',
            t1p2: '',
          });
        }
        setIsModeSelected(true);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `matches/${matchCode}`);
    });

    // Also sync finished matches for this user/match
    const finishedUnsubscribe = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.finishedMatches) {
          setFinishedMatches(data.finishedMatches);
        }
      }
    });

    return () => {
      unsubscribe();
      finishedUnsubscribe();
    };
  }, [matchCode, user]);

  // Sync Local State to Firestore
  const syncToFirestore = useCallback(async (
    newState: MatchState, 
    names: [string, string], 
    bOf: number, 
    gPoint: boolean,
    photos?: Record<string, string>,
    players?: Record<string, string>
  ) => {
    if (!matchCode || !user) return;

    setIsSyncing(true);
    try {
      await setDoc(doc(db, 'matches', matchCode), {
        ...newState,
        teamNames: names,
        bestOf: bOf,
        goldenPoint: gPoint,
        playerPhotos: photos !== undefined ? photos : playerPhotos,
        playerNames: players !== undefined ? players : playerNames,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `matches/${matchCode}`);
    } finally {
      setIsSyncing(false);
    }
  }, [matchCode, user, playerPhotos, playerNames]);

  // Entry point for all state changes - Syncs to DB
  const updateState = (newState: MatchState) => {
    // We update locally for immediate feedback (optimistic UI)
    // but the database remains the final authority
    setHistory((prev) => [...prev, state]);
    setState(newState);
    syncToFirestore(newState, teamNames, bestOf, goldenPoint);
  };

  const handlePhotoUpload = (playerKey: string, file: File) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        // Create canvas for compression (120x120px)
        const canvas = document.createElement('canvas');
        canvas.width = 120;
        canvas.height = 120;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Crop square from the center of the image
          const minDim = Math.min(img.width, img.height);
          const sx = (img.width - minDim) / 2;
          const sy = (img.height - minDim) / 2;
          ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, 120, 120);
          
          const base64Str = canvas.toDataURL('image/jpeg', 0.7); // 70% quality JPEG
          const updatedPhotos = {
            ...playerPhotos,
            [playerKey]: base64Str
          };
          setPlayerPhotos(updatedPhotos);
          syncToFirestore(state, teamNames, bestOf, goldenPoint, updatedPhotos);
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const removePhoto = (playerKey: string) => {
    const updatedPhotos = {
      ...playerPhotos,
      [playerKey]: ''
    };
    setPlayerPhotos(updatedPhotos);
    syncToFirestore(state, teamNames, bestOf, goldenPoint, updatedPhotos);
  };

  const handlePlayerNameChange = (playerKey: string, val: string) => {
    const uppercaseVal = val.toUpperCase();
    const updatedNames = {
      ...playerNames,
      [playerKey]: uppercaseVal
    };
    setPlayerNames(updatedNames);
    
    const t0p1Name = playerKey === 't0p1' ? uppercaseVal : (playerNames.t0p1 || '');
    const t0p2Name = playerKey === 't0p2' ? uppercaseVal : (playerNames.t0p2 || '');
    const t1p1Name = playerKey === 't1p1' ? uppercaseVal : (playerNames.t1p1 || '');
    const t1p2Name = playerKey === 't1p2' ? uppercaseVal : (playerNames.t1p2 || '');

    const t0DisplayName = [t0p1Name, t0p2Name].filter(Boolean).join(' | ') || 'TIME 1';
    const t1DisplayName = [t1p1Name, t1p2Name].filter(Boolean).join(' | ') || 'TIME 2';
    
    const updatedTeamNames: [string, string] = [t0DisplayName, t1DisplayName];
    setTeamNames(updatedTeamNames);

    syncToFirestore(state, updatedTeamNames, bestOf, goldenPoint, playerPhotos, updatedNames);
  };

  const setServingPlayer = (playerIndex: 1 | 2) => {
    const newState = {
      ...state,
      serverPlayer: playerIndex
    };
    setState(newState);
    syncToFirestore(newState, teamNames, bestOf, goldenPoint);
  };

  const login = async () => {
    setLoginError(null);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error("Login error:", error);
      if (error.code === 'auth/popup-closed-by-user') {
        setLoginError("O pop-up de login foi fechado ou sumiu antes de concluir a autenticação. Experimente clicar no botão 'Entrar sem Pop-up (Redirecionamento)' abaixo!");
      } else if (error.code === 'auth/popup-blocked') {
        setLoginError("O navegador bloqueou o pop-up de login. Libere os pop-ups ou use o botão 'Entrar sem Pop-up (Redirecionamento)' abaixo.");
      } else if (error.code === 'auth/unauthorized-domain') {
        setLoginError(`Este domínio (${window.location.hostname}) não está na lista de domínios autorizados no painel do seu Firebase Console. Adicione-o em Authentication -> Settings -> Authorized Domains.`);
      } else {
        setLoginError(`Erro de Login: ${error.message || error}`);
      }
    }
  };

  const loginWithRedirect = async () => {
    setLoginError(null);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithRedirect(auth, provider);
    } catch (error: any) {
      console.error("Login redirect error:", error);
      if (error.code === 'auth/unauthorized-domain') {
        setLoginError(`Este domínio (${window.location.hostname}) não está na lista de domínios autorizados no Firebase Console. Adicione-o em Authentication -> Settings -> Authorized Domains.`);
      } else {
        setLoginError(`Erro no Redirecionamento: ${error.message || error}`);
      }
    }
  };

  const loginAnonymously = async () => {
    setLoginError(null);
    try {
      await signInAnonymously(auth);
    } catch (error: any) {
      console.error("Anonymous login error:", error);
      if (error.code === 'auth/operation-not-allowed') {
        setLoginError("O Login de Visitante (Anônimo) não está ativado no seu painel do Firebase Console. Para corrigir: acesse o console.firebase.google.com -> Authentication -> aba Sign-in method -> Habilite o provedor 'Anônimo' (Anonymous).");
      } else {
        setLoginError(`Erro de Login Visitante: ${error.message || error}`);
      }
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      setMatchCode(null);
      setIsModeSelected(false);
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const handleCopyTVLink = () => {
    if (!matchCode) return;
    const tvLink = `${window.location.origin}/${matchCode}`;
    navigator.clipboard.writeText(tvLink).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 3000);
    }).catch(err => {
      console.error("Failed to copy link:", err);
      alert(`Link para TV: ${tvLink}`);
    });
  };

  const handleCopyCtrlLink = () => {
    if (!matchCode) return;
    const ctrlLink = `${window.location.origin}/${matchCode}/control`;
    navigator.clipboard.writeText(ctrlLink).then(() => {
      setCopiedCtrlLink(true);
      setTimeout(() => setCopiedCtrlLink(false), 3000);
    }).catch(err => {
      console.error("Failed to copy link:", err);
      alert(`Link do Controle: ${ctrlLink}`);
    });
  };

  const createMatch = async () => {
    if (!user) return;
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const initialMatch = {
      points: [0, 0] as [Score, Score],
      games: [0, 0] as [number, number],
      sets: [0, 0] as [number, number],
      setHistory: [],
      server: 0,
      serverPlayer: 2,
      isGameOver: false,
      winner: null,
      gameMode: state.gameMode,
      teamNames,
      bestOf,
      goldenPoint,
      createdByEmail: user.email,
      createdById: user.uid,
    };

    try {
      await setDoc(doc(db, 'matches', code), {
        ...initialMatch,
        updatedAt: serverTimestamp(),
      });
      setMatchCode(code);
      setIsModeSelected(true);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `matches/${code}`);
    }
  };

  const joinMatch = async (code: string) => {
    if (!user || !code) return;
    try {
      const docRef = doc(db, 'matches', code);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setMatchCode(code);
        setIsModeSelected(true);
      } else {
        alert("Partida não encontrada!");
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `matches/${code}`);
    }
  };

  const undo = () => {
    // If the database document synced an undo stack (e.g., from ESP32 clicks)
    if (state.undoStack && state.undoStack.length > 0) {
      const nextUndoStack = [...state.undoStack];
      const prevState = nextUndoStack.pop() as MatchState;
      
      const updatedState = {
        ...prevState,
        undoStack: nextUndoStack,
      };
      
      setState(updatedState);
      syncToFirestore(updatedState, teamNames, bestOf, goldenPoint);
      return;
    }

    // Fallback to local memory undo
    if (history.length === 0) return;
    const prevState = history[history.length - 1];
    setHistory((prev) => prev.slice(0, -1));
    setState(prevState);
    syncToFirestore(prevState, teamNames, bestOf, goldenPoint);
  };

  const reset = () => {
    setShowResetConfirm(true);
  };

  const confirmReset = () => {
    const newState: MatchState = {
      ...state,
      points: [0, 0],
      games: [0, 0],
      sets: [0, 0],
      setHistory: [],
      server: 0,
      serverPlayer: 2,
      isGameOver: false,
      winner: null,
    };
    setState(newState);
    setHistory([]);
    setShowResetConfirm(false);

    const emptyPhotos = {
      t0p1: '',
      t0p2: '',
      t1p1: '',
      t1p2: '',
    };
    const emptyNames = {
      t0p1: '',
      t0p2: '',
      t1p1: '',
      t1p2: '',
    };
    const resetTeamNames: [string, string] = ['TIME 1', 'TIME 2'];

    setPlayerPhotos(emptyPhotos);
    setPlayerNames(emptyNames);
    setTeamNames(resetTeamNames);

    syncToFirestore(newState, resetTeamNames, bestOf, goldenPoint, emptyPhotos, emptyNames);
  };

  const selectMode = (mode: 'padel' | 'beach') => {
    const newGoldenPoint = mode === 'beach' ? true : goldenPoint;
    const newState: MatchState = {
      points: [0, 0],
      games: [0, 0],
      sets: [0, 0],
      setHistory: [],
      server: 0,
      serverPlayer: 2,
      isGameOver: false,
      winner: null,
      gameMode: mode,
      bestOf: bestOf,
      goldenPoint: newGoldenPoint,
      teamNames: teamNames,
    };
    setState(newState);
    setGoldenPoint(newGoldenPoint);
    setIsModeSelected(true);
    setHistory([]);
    if (matchCode) {
      syncToFirestore(newState, teamNames, bestOf, newGoldenPoint);
    }
  };

  const handlePoint = (teamIndex: 0 | 1) => {
    if (state.isGameOver) return;

    // Capture state before this point for undo history
    const { undoStack, ...stateToSave } = state;
    const currentUndoStack = Array.isArray(state.undoStack) ? [...state.undoStack] : [];
    
    currentUndoStack.push(stateToSave);
    if (currentUndoStack.length > 10) {
      currentUndoStack.shift();
    }

    const nextState = processPoint({
      ...state,
      bestOf,
      goldenPoint,
      teamNames,
      undoStack: currentUndoStack,
    }, teamIndex);

    // Save to finished matches history if game ends
    if (nextState.isGameOver && !state.isGameOver) {
      const finishedMatch: FinishedMatch = {
        id: Date.now().toString(),
        date: new Date().toLocaleString('pt-BR'),
        teamNames: [...teamNames] as [string, string],
        sets: [...nextState.sets] as [number, number],
        setHistory: [...nextState.setHistory],
        winner: teamIndex,
      };
      
      if (user) {
        const userRef = doc(db, 'users', user.uid);
        setDoc(userRef, {
          finishedMatches: arrayUnion(finishedMatch)
        }, { merge: true }).catch(err => console.error("Error saving match to history:", err));
      }

      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: state.gameMode === 'padel' ? ['#00FF00', '#FFFFFF', '#000000'] : ['#FF6B00', '#FFFFFF', '#000000']
      });
    }

    updateState(nextState);
  };

  useEffect(() => {
    handlePointRef.current = handlePoint;
  }, [handlePoint]);

  const themeColor = state.gameMode === 'padel' ? '#00FF00' : '#FF6B00';

  if (!isAuthReady) {
    return (
      <div className="fixed inset-0 bg-[#050505] flex items-center justify-center">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-8 h-8 border-2 border-[#00FF00] border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="fixed inset-0 bg-[#050505] text-white font-sans overflow-y-auto py-6 px-4 sm:p-6 select-none flex items-start sm:items-center justify-center">
        <div className="w-full max-w-md text-center my-auto py-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white/5 border border-white/10 rounded-[2.5rem] p-6 sm:p-12 shadow-2xl"
          >
            <div className="w-20 h-20 bg-[#00FF00] rounded-3xl flex items-center justify-center text-black mx-auto mb-8 shadow-[0_0_30px_rgba(0,255,0,0.3)]">
              <Zap size={40} />
            </div>
            <h1 className="text-4xl font-black uppercase italic tracking-tighter mb-4">Padel & Beach</h1>
            <p className="text-white/40 uppercase tracking-widest text-xs mb-12">Placar Profissional em Tempo Real</p>

            {envErrors.length > 0 && (
              <div className="mb-6 p-5 bg-amber-500/10 border border-amber-500/25 rounded-2xl text-amber-100 text-xs text-left leading-relaxed">
                <p className="font-bold mb-2 text-amber-400 flex items-center gap-1 text-[13px]">
                  ⚠️ Variável de Ambiente Invertida!
                </p>
                <ul className="list-disc ml-4 space-y-2 text-amber-200/90 font-medium">
                  {envErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
                <div className="mt-4 pt-3 border-t border-amber-500/15 text-white/70">
                  <p className="font-black mb-1 text-[#00FF00] uppercase tracking-wider text-[10px]">🛠️ Como corrigir no seu Netlify ou Cloud Run:</p>
                  <p className="text-white/60 mb-2">No painel onde você hospedou o app (Netlify ou Cloud Run Service), você colou a <b>Chave de API (Web API Key)</b> no campo da variável <b>VITE_FIREBASE_AUTH_DOMAIN</b>.</p>
                  <ol className="list-decimal ml-4 space-y-2 mt-1 text-white/60">
                    <li>Vá nas <b>Configurações de Ambiente (Environment Variables)</b> do Netlify ou do Cloud Run.</li>
                    <li>Ache a chave <code className="text-amber-400 bg-amber-400/10 px-1 py-0.5 rounded font-mono">VITE_FIREBASE_AUTH_DOMAIN</code>.</li>
                    <li>Mude o valor dela de <code className="bg-black/30 px-1 rounded text-red-400">AIzaSy...</code> para o domínio correto do seu Firebase (ex: <code className="text-green-400">placar-padel.firebaseapp.com</code>).</li>
                    <li>Salve e faça o deploy/reinicie o serviço para aplicar a mudança!</li>
                  </ol>
                </div>
              </div>
            )}
            
            {loginError && (
              <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-100 text-xs text-left leading-relaxed">
                <p className="font-bold mb-1 text-red-400">🚨 Problema de Login:</p>
                <p className="text-red-300 mb-2">{loginError}</p>
                
                <div className="mt-3 pt-3 border-t border-white/10 text-white/70">
                  <p className="font-bold mb-1 text-yellow-400">💡 Como corrigir no Firebase Console:</p>
                  <ol className="list-decimal ml-4 space-y-1 mt-1 text-white/60">
                    <li>Acesse o <a href="https://console.firebase.google.com/" target="_blank" rel="noopener noreferrer" className="underline font-bold text-white hover:text-[#00FF00]">Console do Firebase</a>.</li>
                    <li>Vá em <b>Authentication</b> &rarr; aba <b>Settings</b> (Configurações) &rarr; aba <b>Authorized domains</b> (Domínios autorizados).</li>
                    <li>Clique em <b>Add domain</b> (Adicionar domínio) e adicione o domínio atual:</li>
                  </ol>
                  <div className="mt-3 bg-black/40 p-2 rounded-lg font-mono text-[11px] text-center text-[#00FF00] select-all border border-white/5 font-bold cursor-pointer hover:bg-black/60 transition-all flex items-center justify-center gap-1" title="Selecione e copie este domínio">
                    <span>{window.location.hostname}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <button 
                onClick={loginAnonymously}
                className="w-full py-5 bg-[#00FF00] text-black font-black uppercase italic tracking-tighter rounded-2xl flex items-center justify-center gap-3 hover:opacity-95 transition-all cursor-pointer shadow-[0_0_20px_rgba(0,255,0,0.15)]"
              >
                ⚡ Entrar sem Conta (Visitante)
              </button>

              <div className="py-2 flex items-center justify-center gap-2 text-[10px] text-white/30 uppercase font-bold">
                <span className="h-[1px] w-8 bg-white/10"></span>
                <span>ou sincronize com Google</span>
                <span className="h-[1px] w-8 bg-white/10"></span>
              </div>

              <button 
                onClick={login}
                className="w-full py-4 bg-white text-black font-black uppercase italic tracking-tighter rounded-2xl flex items-center justify-center gap-3 hover:bg-white/90 transition-all cursor-pointer"
              >
                <LogIn size={18} /> Entrar com Google (Pop-up)
              </button>

              <button 
                onClick={loginWithRedirect}
                className="w-full py-3.5 bg-white/5 border border-white/10 text-white/80 font-bold uppercase text-[11px] tracking-wider rounded-2xl flex items-center justify-center gap-2 hover:bg-white/10 transition-all cursor-pointer"
              >
                Entrar com Google (Redirecionar) 🚀
              </button>
            </div>
            <p className="mt-6 text-[10px] text-white/20 uppercase tracking-widest">Necessário para sincronizar entre dispositivos</p>
          </motion.div>
        </div>
      </div>
    );
  }

  if (!matchCode) {
    return (
      <div className="fixed inset-0 bg-[#050505] text-white font-sans overflow-y-auto py-6 px-4 sm:p-6 select-none flex items-start sm:items-center justify-center">
        <div className="w-full max-w-2xl my-auto py-4">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-12"
          >
            <div className="flex flex-col items-center gap-2 mb-6">
              <div className="flex items-center justify-center gap-2">
                {user.photoURL ? (
                  <img src={user.photoURL} className="w-8 h-8 rounded-full border border-[#00FF00]" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-8 h-8 rounded-full border border-[#00FF00] bg-white/10 flex items-center justify-center text-xs text-[#00FF00] font-black uppercase">
                    {user.isAnonymous ? "⚡" : (user.email ? user.email[0] : "P")}
                  </div>
                )}
                <span className="text-xs font-black uppercase tracking-widest text-white/60">
                  Olá, {user.isAnonymous ? "Visitante" : (user.displayName?.split(' ')[0] || user.email?.split('@')[0] || "Placar")}
                </span>
              </div>
              <button 
                onClick={logout}
                className="text-[9px] bg-red-500/10 hover:bg-red-500/20 text-red-400 font-extrabold uppercase tracking-widest px-3 py-1 rounded-full transition-all cursor-pointer animate-pulse"
              >
                Sair da Sessão / Trocar Conta
              </button>
            </div>
            <h1 className="text-5xl font-black uppercase italic tracking-tighter mb-4">Nova Partida</h1>
            <p className="text-white/40 uppercase tracking-widest text-xs">Crie ou entre em uma partida existente</p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <motion.div
              whileHover={{ scale: 1.02 }}
              className="bg-white/5 border border-white/10 rounded-[2rem] p-8"
            >
              <h2 className="text-2xl font-black uppercase italic tracking-tighter mb-6">Criar Partida</h2>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => selectMode('padel')} className={`py-3 rounded-xl font-bold text-xs ${state.gameMode === 'padel' ? 'bg-[#00FF00] text-black' : 'bg-white/5'}`}>PADEL</button>
                  <button onClick={() => selectMode('beach')} className={`py-3 rounded-xl font-bold text-xs ${state.gameMode === 'beach' ? 'bg-[#FF6B00] text-black' : 'bg-white/5'}`}>BEACH</button>
                </div>
                <button 
                  onClick={createMatch}
                  className="w-full py-4 bg-white text-black font-black uppercase italic tracking-tighter rounded-xl hover:bg-[#00FF00] transition-all"
                >
                  Iniciar Agora
                </button>
              </div>
            </motion.div>

            <motion.div
              whileHover={{ scale: 1.02 }}
              className="bg-white/5 border border-white/10 rounded-[2rem] p-8"
            >
              <h2 className="text-2xl font-black uppercase italic tracking-tighter mb-6">Entrar em Partida</h2>
              <div className="space-y-4">
                <input 
                  type="text" 
                  placeholder="CÓDIGO (EX: 1234)" 
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-4 text-center font-black tracking-[0.5em] focus:border-[#00FF00] outline-none"
                />
                <button 
                  onClick={() => joinMatch(joinCodeInput)}
                  className="w-full py-4 bg-white/10 text-white font-black uppercase italic tracking-tighter rounded-xl hover:bg-white/20 transition-all"
                >
                  Entrar
                </button>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    );
  }

  if (isControllerMode) {
    return (
      <div className="min-h-screen bg-[#070709] text-white font-sans overflow-y-auto pb-12 select-none">
        {/* Remote Header */}
        <div className="sticky top-0 bg-black/80 backdrop-blur-md border-b border-white/10 px-4 py-4 flex items-center justify-between z-30">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-[#00FF00] animate-ping" />
            <div>
              <h1 className="text-sm font-black tracking-widest uppercase italic">Controle Remoto</h1>
              <p className="text-[9px] text-[#00FF00] font-bold uppercase tracking-wider">Conectado em tempo real</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1 flex items-center gap-1.5">
              <Users size={10} className="text-white/40" />
              <span className="text-[11px] font-black tracking-widest text-[#00FF00]">{matchCode}</span>
            </div>
          </div>
        </div>

        <div className="p-4 max-w-md mx-auto space-y-6">
          {/* Real-time Match Status (Mini Scoreboard) */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
            <div className="flex justify-between items-center text-[9px] uppercase tracking-widest text-white/40 font-bold">
              <span>Status do Placar (TV)</span>
              {isSyncing ? (
                <span className="text-[#00FF00] animate-pulse">Sincronizando...</span>
              ) : (
                <span className="text-white/20">Sincronizado</span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Team 1 Status */}
              <div className="bg-black/30 p-3 rounded-xl border border-white/5 text-center">
                <span className="text-[10px] font-black block truncate uppercase" style={{ color: '#00FF00' }}>{teamNames[0]}</span>
                <div className="flex justify-center items-baseline gap-2 mt-2">
                  <span className="text-[10px] uppercase text-white/30 font-bold">Games</span>
                  <span className="text-2xl font-black italic" style={{ color: '#00FF00' }}>{state.games[0]}</span>
                  <span className="text-[10px] uppercase text-white/30 font-bold ml-1">Sets</span>
                  <span className="text-lg font-bold text-white/60">{state.sets[0]}</span>
                </div>
                <div className="text-3xl font-black italic tracking-tighter mt-1" style={{ color: '#00FF00' }}>
                  {state.points[0]}
                </div>
              </div>

              {/* Team 2 Status */}
              <div className="bg-black/30 p-3 rounded-xl border border-white/5 text-center">
                <span className="text-[10px] font-black block truncate uppercase" style={{ color: '#00D2FF' }}>{teamNames[1]}</span>
                <div className="flex justify-center items-baseline gap-2 mt-2">
                  <span className="text-[10px] uppercase text-white/30 font-bold">Games</span>
                  <span className="text-2xl font-black italic" style={{ color: '#00D2FF' }}>{state.games[1]}</span>
                  <span className="text-[10px] uppercase text-white/30 font-bold ml-1">Sets</span>
                  <span className="text-lg font-bold text-white/60">{state.sets[1]}</span>
                </div>
                <div className="text-3xl font-black italic tracking-tighter mt-1" style={{ color: '#00D2FF' }}>
                  {state.points[1]}
                </div>
              </div>
            </div>

            {/* Set History overview */}
            {state.setHistory.length > 0 && (
              <div className="pt-2 border-t border-white/5 flex gap-1.5 justify-center">
                {state.setHistory.map((set, i) => (
                  <div key={i} className="bg-black/60 px-2.5 py-1 rounded text-[10px] font-mono flex gap-1 border border-white/5">
                    <span style={{ color: set.t1 > set.t2 ? '#00FF00' : 'rgba(255,255,255,0.4)' }}>{set.t1}</span>
                    <span className="text-white/10">|</span>
                    <span style={{ color: set.t2 > set.t1 ? '#00D2FF' : 'rgba(255,255,255,0.4)' }}>{set.t2}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Huge Touch Scoring Control Buttons */}
          <div className="space-y-3">
            <h3 className="font-bold uppercase text-[10px] tracking-widest text-white/40 text-left">Pontuar (Toque para atualizar na TV)</h3>
            <div className="grid grid-cols-2 gap-4">
              {/* Add Point Team 1 */}
              <button
                onClick={() => handlePoint(0)}
                disabled={state.isGameOver}
                className="h-32 bg-white/5 border border-white/10 rounded-3xl flex flex-col items-center justify-center gap-1 hover:bg-white/10 active:scale-95 transition-all text-center cursor-pointer relative overflow-hidden"
              >
                <div className="absolute top-2 left-2 w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#00FF00' }} />
                <span className="text-[9px] uppercase tracking-widest font-black text-white/40">Soma Ponto</span>
                <span className="text-xs uppercase font-extrabold italic px-2 truncate w-full" style={{ color: '#00FF00' }}>{teamNames[0]}</span>
                <span className="text-4xl font-black italic mt-1" style={{ color: '#00FF00' }}>{state.points[0]}</span>
              </button>

              {/* Add Point Team 2 */}
              <button
                onClick={() => handlePoint(1)}
                disabled={state.isGameOver}
                className="h-32 bg-white/5 border border-white/10 rounded-3xl flex flex-col items-center justify-center gap-1 hover:bg-white/10 active:scale-95 transition-all text-center cursor-pointer relative overflow-hidden"
              >
                <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#00D2FF' }} />
                <span className="text-[9px] uppercase tracking-widest font-black text-white/40">Soma Ponto</span>
                <span className="text-xs uppercase font-extrabold italic px-2 truncate w-full" style={{ color: '#00D2FF' }}>{teamNames[1]}</span>
                <span className="text-4xl font-black italic mt-1" style={{ color: '#00D2FF' }}>{state.points[1]}</span>
              </button>
            </div>
          </div>

          {/* Quick Actions (Undo, Reset) */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={undo}
              disabled={history.length === 0}
              className="py-3 bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-20 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Undo2 size={14} /> Desfazer
            </button>
            <button
              onClick={reset}
              className="py-3 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-colors text-red-400 cursor-pointer"
            >
              <RotateCcw size={14} /> Zerar Partida
            </button>
          </div>


          {/* Full Inline Configurations Panel */}
          <div className="space-y-4 pt-2">
            <h3 className="font-extrabold uppercase text-xs tracking-widest text-[#00FF00] border-b border-white/10 pb-1 text-left">Configurações Rápidas</h3>
            
            {/* Mode selector */}
            <div className="space-y-2">
              <span className="font-bold uppercase text-[9px] tracking-widest text-white/40 block text-left">Modalidade</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => selectMode('padel')}
                  className={`py-3 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 ${
                    state.gameMode === 'padel' ? 'bg-[#00FF00] text-black font-black' : 'bg-white/5 text-white/80'
                  }`}
                >
                  <Zap size={14} /> PADEL
                </button>
                <button
                  onClick={() => selectMode('beach')}
                  className={`py-3 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 ${
                    state.gameMode === 'beach' ? 'bg-[#FF6B00] text-black font-black' : 'bg-white/5 text-white/80'
                  }`}
                >
                  <Waves size={14} /> BEACH
                </button>
              </div>
            </div>

            {/* Golden Point Switch */}
            <div className={`flex items-center justify-between p-3.5 bg-white/5 rounded-2xl border border-white/5 ${state.gameMode === 'beach' ? 'opacity-50 pointer-events-none' : ''}`}>
              <div className="text-left">
                <h4 className="font-bold text-xs">Ponto de Ouro</h4>
                <p className="text-[9px] text-white/40">{state.gameMode === 'beach' ? 'Obrigatório no Beach Tennis' : 'Sem vantagem (Deuce)'}</p>
              </div>
              <button 
                onClick={() => setGoldenPoint(!goldenPoint)}
                className="w-12 h-7 rounded-full transition-colors relative"
                style={{ backgroundColor: goldenPoint ? themeColor : 'rgba(255,255,255,0.1)' }}
              >
                <motion.div 
                  animate={{ x: goldenPoint ? 22 : 3 }}
                  className="absolute top-1 w-5 h-5 bg-white rounded-full shadow-lg"
                />
              </button>
            </div>

            {/* Best Of selection */}
            <div className="space-y-2">
              <span className="font-bold uppercase text-[9px] tracking-widest text-white/40 block text-left">Melhor de</span>
              <div className="grid grid-cols-4 gap-2">
                {[1, 3, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setBestOf(n)}
                    className="py-3 rounded-xl font-black text-xs transition-all animate-none"
                    style={{ 
                      backgroundColor: bestOf === n ? themeColor : 'rgba(255,255,255,0.05)',
                      color: bestOf === n ? 'black' : 'white'
                    }}
                  >
                    {n} SETS
                  </button>
                ))}
                <button
                  onClick={() => setBestOf(0)}
                  className="py-3 rounded-xl font-black text-[9px] transition-all flex flex-col items-center justify-center leading-tight border border-transparent"
                  style={{ 
                    backgroundColor: bestOf === 0 ? themeColor : 'rgba(255,255,255,0.05)',
                    color: bestOf === 0 ? 'black' : 'white'
                  }}
                >
                  <span>TREINO</span>
                </button>
              </div>
            </div>

            {/* Players Registration Forms */}
            <div className="space-y-3 pt-2">
              <span className="font-bold uppercase text-[9px] tracking-widest text-white/40 block text-left font-black">Cadastro dos Jogadores</span>
              
              <div className="space-y-4">
                {/* Team 1 Registration */}
                <div className="bg-white/5 border border-white/5 p-4 rounded-2xl space-y-3">
                  <h4 className="text-[10px] uppercase tracking-widest text-[#00FF00] font-black border-b border-white/5 pb-1 text-left">Nomes & Fotos - Time 1</h4>
                  
                  {/* T0 P1 */}
                  <div className="space-y-1">
                    <span className="text-[8px] uppercase text-white/40 font-bold block text-left">Jogador 1 (Esquerda)</span>
                    <div className="flex items-center gap-3">
                      <div className="relative w-14 h-14 shrink-0">
                        {playerPhotos.t0p1 ? (
                          <>
                            <img src={playerPhotos.t0p1} className="w-full h-full rounded-lg object-cover border border-white/20" alt="Jogador 1" />
                            <button onClick={() => removePhoto('t0p1')} className="absolute -top-1 -right-1 bg-red-500 p-0.5 rounded-full text-white cursor-pointer"><Trash2 size={10} /></button>
                          </>
                        ) : (
                          <label className="w-full h-full rounded-lg bg-white/5 border border-dashed border-white/20 flex items-center justify-center cursor-pointer hover:bg-white/10">
                            <Camera size={14} className="text-white/40" />
                            <input type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handlePhotoUpload('t0p1', file); }} />
                          </label>
                        )}
                      </div>
                      <input type="text" placeholder="Nome do Jogador 1" value={playerNames.t0p1 || ''} onChange={(e) => handlePlayerNameChange('t0p1', e.target.value)} className="flex-1 bg-black/40 border border-white/5 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:border-[#00FF00] outline-none transition-colors text-white" />
                    </div>
                  </div>

                  {/* T0 P2 */}
                  <div className="space-y-1 pt-1">
                    <span className="text-[8px] uppercase text-white/40 font-bold block text-left">Jogador 2 (Direita)</span>
                    <div className="flex items-center gap-3">
                      <div className="relative w-14 h-14 shrink-0">
                        {playerPhotos.t0p2 ? (
                          <>
                            <img src={playerPhotos.t0p2} className="w-full h-full rounded-lg object-cover border border-white/20" alt="Jogador 2" />
                            <button onClick={() => removePhoto('t0p2')} className="absolute -top-1 -right-1 bg-red-500 p-0.5 rounded-full text-white cursor-pointer"><Trash2 size={10} /></button>
                          </>
                        ) : (
                          <label className="w-full h-full rounded-lg bg-white/5 border border-dashed border-white/20 flex items-center justify-center cursor-pointer hover:bg-white/10">
                            <Camera size={14} className="text-white/40" />
                            <input type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handlePhotoUpload('t0p2', file); }} />
                          </label>
                        )}
                      </div>
                      <input type="text" placeholder="Nome do Jogador 2" value={playerNames.t0p2 || ''} onChange={(e) => handlePlayerNameChange('t0p2', e.target.value)} className="flex-1 bg-black/40 border border-white/5 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:border-[#00FF00] outline-none transition-colors text-white" />
                    </div>
                  </div>
                </div>

                {/* Team 2 Registration */}
                <div className="bg-white/5 border border-white/5 p-4 rounded-2xl space-y-3">
                  <h4 className="text-[10px] uppercase tracking-widest text-[#FF6B00] font-black border-b border-white/5 pb-1 text-left">Nomes & Fotos - Time 2</h4>
                  
                  {/* T1 P1 */}
                  <div className="space-y-1">
                    <span className="text-[8px] uppercase text-white/40 font-bold block text-left">Jogador 1 (Esquerda)</span>
                    <div className="flex items-center gap-3">
                      <div className="relative w-14 h-14 shrink-0">
                        {playerPhotos.t1p1 ? (
                          <>
                            <img src={playerPhotos.t1p1} className="w-full h-full rounded-lg object-cover border border-white/20" alt="Jogador 1" />
                            <button onClick={() => removePhoto('t1p1')} className="absolute -top-1 -right-1 bg-red-500 p-0.5 rounded-full text-white cursor-pointer"><Trash2 size={10} /></button>
                          </>
                        ) : (
                          <label className="w-full h-full rounded-lg bg-white/5 border border-dashed border-white/20 flex items-center justify-center cursor-pointer hover:bg-white/10">
                            <Camera size={14} className="text-white/40" />
                            <input type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handlePhotoUpload('t1p1', file); }} />
                          </label>
                        )}
                      </div>
                      <input type="text" placeholder="Nome do Jogador 1" value={playerNames.t1p1 || ''} onChange={(e) => handlePlayerNameChange('t1p1', e.target.value)} className="flex-1 bg-black/40 border border-white/5 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:border-[#00FF00] outline-none transition-colors text-white" />
                    </div>
                  </div>

                  {/* T1 P2 */}
                  <div className="space-y-1 pt-1">
                    <span className="text-[8px] uppercase text-white/40 font-bold block text-left">Jogador 2 (Direita)</span>
                    <div className="flex items-center gap-3">
                      <div className="relative w-14 h-14 shrink-0">
                        {playerPhotos.t1p2 ? (
                          <>
                            <img src={playerPhotos.t1p2} className="w-full h-full rounded-lg object-cover border border-white/20" alt="Jogador 2" />
                            <button onClick={() => removePhoto('t1p2')} className="absolute -top-1 -right-1 bg-red-500 p-0.5 rounded-full text-white cursor-pointer"><Trash2 size={10} /></button>
                          </>
                        ) : (
                          <label className="w-full h-full rounded-lg bg-white/5 border border-dashed border-white/20 flex items-center justify-center cursor-pointer hover:bg-white/10">
                            <Camera size={14} className="text-white/40" />
                            <input type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handlePhotoUpload('t1p2', file); }} />
                          </label>
                        )}
                      </div>
                      <input type="text" placeholder="Nome do Jogador 2" value={playerNames.t1p2 || ''} onChange={(e) => handlePlayerNameChange('t1p2', e.target.value)} className="flex-1 bg-black/40 border border-white/5 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:border-[#00FF00] outline-none transition-colors text-white" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Exit Setup Button */}
            <button
              onClick={() => {
                setSavedFeedback(true);
                setTimeout(() => setSavedFeedback(false), 2500);
              }}
              className="w-full mt-4 py-4 font-black uppercase tracking-wider rounded-2xl italic flex items-center justify-center gap-2 cursor-pointer shadow-lg active:scale-95 transition-all text-xs"
              style={{
                backgroundColor: savedFeedback ? '#00FF00' : '#FFFFFF',
                color: '#000000'
              }}
            >
              <Check size={14} /> {savedFeedback ? 'Partida Salva!' : 'Salvar Partida'}
            </button>
          </div>
        </div>

        {/* Reset Confirmation Modal */}
        <AnimatePresence>
          {showResetConfirm && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/90 backdrop-blur-md"
            >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 20 }}
                className="w-full max-w-xs bg-[#111] border border-white/10 rounded-3xl p-8 shadow-2xl text-center"
              >
                <RotateCcw size={48} className="text-red-500 mx-auto mb-4" />
                <h2 className="text-xl font-black uppercase italic tracking-tighter mb-2">Resetar Partida?</h2>
                <p className="text-sm text-white/40 mb-8">Todo o progresso atual será perdido permanentemente.</p>
                
                <div className="flex flex-col gap-3">
                  <button 
                    onClick={confirmReset}
                    className="w-full py-4 bg-red-500 text-white font-black uppercase italic tracking-tighter rounded-2xl hover:bg-red-600 transition-colors cursor-pointer"
                  >
                    Sim, Resetar
                  </button>
                  <button 
                    onClick={() => setShowResetConfirm(false)}
                    className="w-full py-4 bg-white/5 text-white font-black uppercase italic tracking-tighter rounded-2xl hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    Cancelar
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-[#050505] text-white font-sans overflow-hidden select-none">
      {/* Voice Commands Notification Overlay */}
      <AnimatePresence>
        {isListening && (
          <motion.div 
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -20, x: '-50%' }}
            className="fixed top-20 left-1/2 z-40 bg-black/90 border border-white/10 px-4 py-2 rounded-full flex items-center gap-2.5 shadow-2xl backdrop-blur-md whitespace-nowrap"
          >
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
            <span className="text-[10px] uppercase font-black tracking-widest text-white/80">
              🎙️ Ouvindo: Fale <span className="text-[#00FF00]">"Verde"</span> ou <span className="text-[#00D2FF]">"Azul"</span> para pontuar
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {voiceNotification && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.8, y: -20, x: '-50%' }}
            animate={{ opacity: 1, scale: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, scale: 0.8, y: -20, x: '-50%' }}
            className="fixed top-36 left-1/2 z-50 bg-[#111]/95 border-2 border-white/15 px-6 py-3.5 rounded-2xl flex items-center gap-3.5 shadow-2xl backdrop-blur-xl whitespace-nowrap"
          >
            <div className="text-2xl animate-bounce">🎙️</div>
            <span className="text-sm font-black uppercase tracking-wider text-white animate-pulse">
              {voiceNotification}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Header / Stats */}
      <div className="absolute top-0 left-0 right-0 h-16 flex items-center justify-between px-6 border-b border-white/10 bg-black/50 backdrop-blur-md z-20">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold tracking-tighter uppercase italic" style={{ color: themeColor }}>
            {state.gameMode === 'padel' ? 'Padel Score' : 'Beach Score'}
          </h1>
          <div className="flex items-center gap-2 bg-white/5 px-3 py-1 rounded-full border border-white/10">
            <Users size={12} className="text-white/40" />
            <span className="text-[10px] font-black tracking-widest text-white/60">{matchCode}</span>
          </div>
          {state.createdByEmail && (
            <div className="hidden sm:flex items-center gap-1 text-[10px] text-white/20 uppercase tracking-widest">
              <span>Iniciado por:</span>
              <span className="font-bold">{state.createdByEmail.split('@')[0]}</span>
            </div>
          )}
          <div className="flex gap-2">
            {state.setHistory.map((set, i) => (
              <div key={i} className="flex gap-1 bg-white/5 px-2 py-1 rounded text-xs font-mono">
                <span className={set.t1 > set.t2 ? '' : 'text-white/40'} style={{ color: set.t1 > set.t2 ? '#00FF00' : undefined }}>{set.t1}</span>
                <span className="text-white/20">|</span>
                <span className={set.t2 > set.t1 ? '' : 'text-white/40'} style={{ color: set.t2 > set.t1 ? '#00D2FF' : undefined }}>{set.t2}</span>
              </div>
            ))}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowHistory(true)}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
            style={{ color: themeColor }}
            title="Histórico de Partidas"
          >
            <History size={20} />
          </button>
          <button 
            onClick={undo}
            disabled={history.length === 0}
            className="p-2 hover:bg-white/10 rounded-full transition-colors disabled:opacity-20"
          >
            <Undo2 size={20} />
          </button>
          <div className="relative">
            <button 
              onClick={handleCopyTVLink}
              className="p-2 hover:bg-white/10 rounded-full transition-all text-yellow-400 flex items-center justify-center"
              title="Copiar Link para TV / Transmissão"
            >
              <Share2 size={20} />
            </button>
            <AnimatePresence>
              {copiedLink && (
                <motion.span 
                  initial={{ opacity: 0, y: 10, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.9 }}
                  className="absolute top-12 right-0 bg-yellow-400 text-black text-[9px] font-black px-2.5 py-1.5 rounded-lg shadow-xl whitespace-nowrap uppercase tracking-widest leading-none z-30"
                >
                  Link Copiado! 📺
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <button 
            onClick={() => setShowSettings(true)}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
          >
            <Settings size={20} />
          </button>
          {voiceSupported && (
            <button 
              onClick={toggleListening}
              className={`p-2 rounded-full transition-all flex items-center justify-center relative ${
                isListening 
                  ? 'text-red-500 bg-red-500/10 ring-2 ring-red-500/40' 
                  : 'text-white/60 hover:bg-white/10'
              }`}
              title={isListening ? "Desativar comandos de voz (Microfone Ativo)" : "Ativar comandos de voz (Diga 'Verde' ou 'Azul' para pontuar)"}
            >
              {isListening ? (
                <>
                  <Mic size={20} />
                  <span className="absolute -top-1 -right-1 flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                  </span>
                </>
              ) : (
                <MicOff size={20} />
              )}
            </button>
          )}
          <button 
            onClick={reset}
            className="p-2 hover:bg-white/10 rounded-full transition-colors text-red-500"
          >
            <RotateCcw size={20} />
          </button>
        </div>
      </div>

      {/* Main Scoreboard */}
      <div className="flex h-full pt-16">
        {[0, 1].map((teamIndex) => {
          const srvPlayer = state.serverPlayer || 2;
          const activeServerPhoto = playerPhotos[`t${teamIndex}p${srvPlayer}`];
          const activeServerName = playerNames[`t${teamIndex}p${srvPlayer}`];
          const teamColor = teamIndex === 0 ? '#00FF00' : '#00D2FF';

          return (
            <div 
              key={teamIndex}
              onClick={() => handlePoint(teamIndex as 0 | 1)}
              className={`relative flex-1 flex flex-col items-center justify-center cursor-pointer transition-all duration-300 active:scale-[0.98] ${
                teamIndex === 0 ? 'border-r border-white/10' : ''
              } hover:bg-white/[0.02]`}
              style={{
                background: teamIndex === 0 
                  ? 'radial-gradient(circle at center, rgba(0, 255, 0, 0.04) 0%, transparent 75%)' 
                  : 'radial-gradient(circle at center, rgba(0, 210, 255, 0.04) 0%, transparent 75%)'
              }}
            >
            {/* Server Indicator */}
            <div className="absolute top-4 flex flex-col items-center gap-1.5">
               <span 
                 className="text-sm uppercase tracking-[0.3em] font-black italic transition-all duration-300"
                 style={{ 
                   color: teamColor,
                   textShadow: `0 0 10px ${teamColor}33`
                 }}
               >
                 {teamNames[teamIndex]}
               </span>
               {state.server === teamIndex && !state.isGameOver && (
                 <motion.div 
                   layoutId="server"
                   className="w-1.5 h-1.5 rounded-full animate-pulse"
                   style={{ 
                     backgroundColor: teamColor,
                     boxShadow: `0 0 10px ${teamColor}`
                   }}
                 />
               )}
            </div>

            {/* Player Photos overlay display on Scoreboard */}
            <div className="absolute top-12 flex items-center justify-center -space-x-3 sm:-space-x-4 md:-space-x-5">
              {[1, 2].map((idx) => {
                const key = `t${teamIndex}p${idx}`;
                const photo = playerPhotos[key];
                const name = playerNames[key];
                const isServingThisGame = state.server === teamIndex && srvPlayer === idx;
                const canSelectServer = state.server === teamIndex;

                return (
                  <div 
                    key={key} 
                    className={`relative group ${canSelectServer ? 'cursor-pointer' : ''}`}
                    onClick={(e) => {
                      if (canSelectServer) {
                        e.stopPropagation();
                        setServingPlayer(idx as 1 | 2);
                      }
                    }}
                  >
                    {photo ? (
                      <img 
                        src={photo}
                        className={`w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 rounded-full object-cover border-2 shadow-md transition-all ${
                          isServingThisGame 
                            ? 'scale-110 ring-4 ring-[#ccff00]/40 shadow-[0_0_12px_rgba(204,255,0,0.5)]' 
                            : 'group-hover:scale-110'
                        }`}
                        style={{ borderColor: isServingThisGame ? '#ccff00' : teamColor }}
                        alt={name || `Jogador ${idx}`}
                      />
                    ) : (
                      <div 
                        className={`w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 rounded-full bg-white/5 border flex items-center justify-center text-[11px] sm:text-[13px] md:text-[14px] uppercase font-bold transition-all ${
                          isServingThisGame 
                            ? 'scale-110 bg-white/10 ring-4 ring-[#ccff00]/40 text-white border-[#ccff00]' 
                            : 'text-white/30 hover:bg-white/10 border-white/10'
                        }`}
                        style={{ borderColor: isServingThisGame ? '#ccff00' : teamColor }}
                      >
                        J{idx}
                      </div>
                    )}

                    {/* Tiny Service Badge */}
                    {isServingThisGame && (
                      <div 
                        className="absolute -top-1 -right-1 w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center shadow-lg animate-bounce"
                        style={{ 
                          backgroundColor: '#ccff00',
                          boxShadow: '0 0 8px #ccff00'
                        }}
                        title="Sacador Atual"
                      >
                        <span className="text-[9px] sm:text-[11px] text-black font-black leading-none">S</span>
                      </div>
                    )}
                    
                    {/* Tooltip on hover/touch */}
                    {name && (
                      <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-black/95 border border-white/10 rounded text-[8px] font-black tracking-wider text-white uppercase whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-45 shadow-xl">
                        {name}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Sets & Games */}
            <div className="absolute top-32 sm:top-36 md:top-42 flex gap-8 sm:gap-10 items-center">
              <div className="flex flex-col items-center">
                <span className="text-[10px] sm:text-xs uppercase tracking-[0.2em] text-white/30 mb-0.5 sm:mb-1">Sets</span>
                <span className="text-4xl sm:text-6xl font-black italic leading-none">{state.sets[teamIndex]}</span>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-[10px] sm:text-xs uppercase tracking-[0.2em] text-white/30 mb-0.5 sm:mb-1">Games</span>
                <span className="text-4xl sm:text-6xl font-black italic leading-none" style={{ color: teamColor }}>{state.games[teamIndex]}</span>
              </div>
            </div>

            {/* Points */}
            <motion.div 
              key={state.points[teamIndex]}
              initial={{ scale: 0.8, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              className="text-[15vw] sm:text-[20vw] font-black tracking-tighter leading-none italic select-none"
              style={{ 
                color: teamColor,
                textShadow: `0 0 40px ${teamColor}1A`
              }}
            >
              {state.points[teamIndex]}
            </motion.div>

            {/* Serving Side Indicator (Padel Ball) */}
            {state.server === teamIndex && !state.isGameOver && state.gameMode === 'padel' && (
              <div className="absolute bottom-20 w-full px-12 flex justify-between pointer-events-none">
                <AnimatePresence mode="wait">
                  {(getPointCount(state.points[0]) + getPointCount(state.points[1])) % 2 === 0 ? (
                    activeServerPhoto ? (
                      <motion.div
                        key="right-photo"
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        className="ml-auto relative flex flex-col items-center"
                      >
                        <img 
                          src={activeServerPhoto} 
                          className="w-14 h-14 rounded-full object-cover border-2 shadow-[0_0_15px_#ccff00] animate-pulse" 
                          style={{ borderColor: '#ccff00' }}
                          alt={activeServerName || "Sacador"}
                        />
                        <span className="text-[8px] font-black uppercase text-[#ccff00] mt-1 tracking-wider bg-black/60 px-1.5 py-0.5 rounded">SAQUE</span>
                      </motion.div>
                    ) : (
                      <motion.div 
                        key="right"
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        className="ml-auto w-12 h-12 rounded-full border-2 border-black/20 flex items-center justify-center relative cursor-none"
                        style={{ 
                          backgroundColor: '#ccff00',
                          boxShadow: '0 0 15px #ccff00'
                        }}
                      >
                        <div className="w-full h-[1px] bg-black/15 rotate-45" />
                        <div className="w-full h-[1px] bg-black/15 -rotate-45 absolute" />
                      </motion.div>
                    )
                  ) : (
                    activeServerPhoto ? (
                      <motion.div
                        key="left-photo"
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        className="mr-auto relative flex flex-col items-center"
                      >
                        <img 
                          src={activeServerPhoto} 
                          className="w-14 h-14 rounded-full object-cover border-2 shadow-[0_0_15px_#ccff00] animate-pulse" 
                          style={{ borderColor: '#ccff00' }}
                          alt={activeServerName || "Sacador"}
                        />
                        <span className="text-[8px] font-black uppercase text-[#ccff00] mt-1 tracking-wider bg-black/60 px-1.5 py-0.5 rounded">SAQUE</span>
                      </motion.div>
                    ) : (
                      <motion.div 
                        key="left"
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        className="mr-auto w-12 h-12 rounded-full border-2 border-black/20 flex items-center justify-center relative cursor-none"
                        style={{ 
                          backgroundColor: '#ccff00',
                          boxShadow: '0 0 15px #ccff00'
                        }}
                      >
                        <div className="w-full h-[1px] bg-black/15 rotate-45" />
                        <div className="w-full h-[1px] bg-black/15 -rotate-45 absolute" />
                      </motion.div>
                    )
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Winner Overlay */}
            {state.isGameOver && state.winner === teamIndex && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute inset-0 flex flex-col items-center justify-center backdrop-blur-sm"
                style={{ backgroundColor: `${teamColor}1A` }}
              >
                <Trophy size={80} className="mb-4" style={{ color: teamColor }} />
                <span className="text-4xl font-black uppercase italic tracking-tighter" style={{ color: teamColor }}>Winner</span>
              </motion.div>
            )}
          </div>
        )})}
      </div>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-xl"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-md bg-[#111] border border-white/10 rounded-3xl p-6 sm:p-8 shadow-2xl flex flex-col max-h-[90vh]"
            >
              <div className="flex justify-between items-center mb-6 shrink-0">
                <h2 className="text-2xl font-black uppercase italic tracking-tighter">Configurações</h2>
                <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-white/10 rounded-full">
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-6 overflow-y-auto flex-1 pr-1 -mr-1 min-h-0 select-none">
                {/* Match Info */}
                <div className="p-4 bg-white/5 rounded-2xl border border-white/10 space-y-4 text-left">
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="font-bold text-[10px] uppercase tracking-widest text-white/40">Código da Partida</h3>
                      <p className="text-3xl font-black tracking-[0.2em]" style={{ color: themeColor }}>{matchCode}</p>
                    </div>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(matchCode || '');
                        alert("Código de 4 dígitos copiado!");
                      }}
                      className="py-1.5 px-3 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-all text-white/80 font-black text-[9px] uppercase tracking-wider flex items-center gap-1"
                      title="Copiar Código"
                    >
                      <Check size={10} className="text-[#00FF00]" />
                      Copiar Código
                    </button>
                  </div>
                  
                  <div className="pt-3 border-t border-white/5 space-y-2">
                    <h4 className="font-bold text-[10px] uppercase tracking-widest text-yellow-400">📺 Transmitir em Smart TV (Link Direto)</h4>
                    <p className="text-[11px] text-white/50 leading-relaxed font-medium">
                      Abra este link em qualquer computador, celular ou Smart TV na quadra para exibir o placar sincronizado em tempo real:
                    </p>
                    <div className="flex gap-2 items-center">
                      <div className="flex-1 bg-black/40 border border-white/5 p-2 rounded-lg select-all text-[11px] font-mono text-white/70 overflow-hidden text-ellipsis whitespace-nowrap">
                        {window.location.origin}/{matchCode}
                      </div>
                      <button 
                        onClick={handleCopyTVLink}
                        className="py-2 px-3 bg-yellow-400 hover:bg-yellow-300 text-black font-extrabold text-[10px] uppercase tracking-wider rounded-lg transition-all flex items-center gap-1 shrink-0"
                      >
                        <Share2 size={10} />
                        {copiedLink ? "Copiado!" : "Copiar"}
                      </button>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-white/5 space-y-2">
                    <h4 className="font-bold text-[10px] uppercase tracking-widest text-[#00FF00]">📱 Controle pelo Celular (Remoto)</h4>
                    <p className="text-[11px] text-white/50 leading-relaxed font-medium">
                      Abra este link no celular para gerenciar o placar, mudar nomes, carregar fotos dos jogadores e zerar a partida:
                    </p>
                    <div className="flex gap-2 items-center">
                      <div className="flex-1 bg-black/40 border border-white/5 p-2 rounded-lg select-all text-[11px] font-mono text-[#00FF00] overflow-hidden text-ellipsis whitespace-nowrap font-bold">
                        {window.location.origin}/{matchCode}/control
                      </div>
                      <button 
                        onClick={handleCopyCtrlLink}
                        className="py-2 px-3 bg-[#00FF00] hover:opacity-90 text-black font-extrabold text-[10px] uppercase tracking-wider rounded-lg transition-all flex items-center gap-1 shrink-0"
                      >
                        <Share2 size={10} />
                        {copiedCtrlLink ? "Copiado!" : "Copiar"}
                      </button>
                    </div>

                    {ctrlQrCode && (
                      <div className="pt-3 flex flex-col items-center gap-2 bg-black/30 rounded-xl p-3 border border-white/5">
                        <div className="p-2 bg-white rounded-xl shadow-md inline-block">
                          <img 
                            src={ctrlQrCode} 
                            className="w-32 h-32 block" 
                            alt="QR Code Controle Celular" 
                          />
                        </div>
                        <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-white/55 font-extrabold">
                          <QrCode size={10} className="text-[#00FF00]" />
                          <span>Escanear QR Code para Controlar</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="pt-3 border-t border-white/5 space-y-2">
                    <h4 className="font-bold text-[10px] uppercase tracking-widest text-[#00D2FF] flex items-center gap-1">
                      <span>🎙️</span> Comandos de Voz (Novidade!)
                    </h4>
                    <p className="text-[11px] text-white/50 leading-relaxed font-medium">
                      Ative o microfone pelo botão de microfone no cabeçalho. Quando ativo, você pode falar os seguintes comandos para pontuar as equipes sem encostar na tela:
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-[10px] font-bold text-center">
                      <div className="bg-black/40 border border-[#00FF00]/25 p-2 rounded-xl flex flex-col items-center">
                        <span className="text-[#00FF00] mb-1 font-black uppercase tracking-wider">Time Verde</span>
                        <span className="text-white font-black text-xs">"Verde"</span>
                        <span className="text-white/40 text-[8px] mt-0.5">("Ponto verde", "Marcar verde")</span>
                      </div>
                      <div className="bg-black/40 border border-[#00D2FF]/25 p-2 rounded-xl flex flex-col items-center">
                        <span className="text-[#00D2FF] mb-1 font-black uppercase tracking-wider">Time Azul</span>
                        <span className="text-white font-black text-xs">"Azul"</span>
                        <span className="text-white/40 text-[8px] mt-0.5">("Ponto azul", "Marcar azul")</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Game Mode Selection */}
                <div className="space-y-4">
                  <h3 className="font-bold uppercase text-xs tracking-widest text-white/40">Modalidade</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => selectMode('padel')}
                      className={`py-4 rounded-2xl font-black transition-all flex items-center justify-center gap-2 ${
                        state.gameMode === 'padel' ? 'bg-[#00FF00] text-black' : 'bg-white/5 text-white'
                      }`}
                    >
                      <Zap size={16} /> PADEL
                    </button>
                    <button
                      onClick={() => selectMode('beach')}
                      className={`py-4 rounded-2xl font-black transition-all flex items-center justify-center gap-2 ${
                        state.gameMode === 'beach' ? 'bg-[#FF6B00] text-black' : 'bg-white/5 text-white'
                      }`}
                    >
                      <Waves size={16} /> BEACH
                    </button>
                  </div>
                </div>

                {/* Team Names & Player Photos */}
                <div className="space-y-4">
                  <h3 className="font-bold uppercase text-xs tracking-widest text-white/40 text-left">Jogadores (Fotos e Nomes)</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {/* Time 1 */}
                    <div className="space-y-3">
                      <h4 className="text-[10px] uppercase tracking-widest text-white/60 font-black border-b border-white/5 pb-1 text-left">Time 1</h4>
                      
                      {/* Player 1 */}
                      <div className="space-y-1 bg-white/5 p-2 rounded-xl border border-white/5">
                        <span className="text-[8px] uppercase text-white/40 font-bold block text-left">Jogador 1 (Esquerda)</span>
                        <div className="flex items-center gap-2">
                          <div className="relative w-14 h-14 shrink-0">
                            {playerPhotos.t0p1 ? (
                              <>
                                <img 
                                  src={playerPhotos.t0p1} 
                                  className="w-full h-full rounded-lg object-cover border border-white/20" 
                                  alt="Jogador 1"
                                />
                                <button 
                                  onClick={() => removePhoto('t0p1')}
                                  className="absolute -top-1 -right-1 bg-red-500 hover:bg-red-600 p-0.5 rounded-full text-white transition-all shadow-md cursor-pointer"
                                  title="Remover Foto"
                                >
                                  <Trash2 size={10} />
                                </button>
                              </>
                            ) : (
                              <label className="w-full h-full rounded-lg bg-white/5 border border-dashed border-white/20 flex flex-col items-center justify-center cursor-pointer hover:bg-white/10 hover:border-white/30 transition-all">
                                <Camera size={14} className="text-white/40" />
                                <input 
                                  type="file" 
                                  accept="image/*" 
                                  className="hidden" 
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) handlePhotoUpload('t0p1', file);
                                  }} 
                                />
                              </label>
                            )}
                          </div>
                          <input 
                            type="text" 
                            placeholder="NOME"
                            value={playerNames.t0p1 || ''} 
                            onChange={(e) => handlePlayerNameChange('t0p1', e.target.value)}
                            className="flex-1 min-w-0 bg-black/40 border border-white/5 rounded-lg px-2 py-1.5 text-[10px] font-bold focus:border-[#00FF00] outline-none transition-colors text-white"
                          />
                        </div>
                      </div>

                      {/* Player 2 */}
                      <div className="space-y-1 bg-white/5 p-2 rounded-xl border border-white/5">
                        <span className="text-[8px] uppercase text-white/40 font-bold block text-left">Jogador 2 (Direita)</span>
                        <div className="flex items-center gap-2">
                          <div className="relative w-14 h-14 shrink-0">
                            {playerPhotos.t0p2 ? (
                              <>
                                <img 
                                  src={playerPhotos.t0p2} 
                                  className="w-full h-full rounded-lg object-cover border border-white/20" 
                                  alt="Jogador 2"
                                />
                                <button 
                                  onClick={() => removePhoto('t0p2')}
                                  className="absolute -top-1 -right-1 bg-red-500 hover:bg-red-600 p-0.5 rounded-full text-white transition-all shadow-md cursor-pointer"
                                  title="Remover Foto"
                                >
                                  <Trash2 size={10} />
                                </button>
                              </>
                            ) : (
                              <label className="w-full h-full rounded-lg bg-white/5 border border-dashed border-white/20 flex flex-col items-center justify-center cursor-pointer hover:bg-white/10 hover:border-white/30 transition-all">
                                <Camera size={14} className="text-white/40" />
                                <input 
                                  type="file" 
                                  accept="image/*" 
                                  className="hidden" 
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) handlePhotoUpload('t0p2', file);
                                  }} 
                                />
                              </label>
                            )}
                          </div>
                          <input 
                            type="text" 
                            placeholder="NOME"
                            value={playerNames.t0p2 || ''} 
                            onChange={(e) => handlePlayerNameChange('t0p2', e.target.value)}
                            className="flex-1 min-w-0 bg-black/40 border border-white/5 rounded-lg px-2 py-1.5 text-[10px] font-bold focus:border-[#00FF00] outline-none transition-colors text-white"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Time 2 */}
                    <div className="space-y-3">
                      <h4 className="text-[10px] uppercase tracking-widest text-white/60 font-black border-b border-white/5 pb-1 text-left">Time 2</h4>
                      
                      {/* Player 1 */}
                      <div className="space-y-1 bg-white/5 p-2 rounded-xl border border-white/5">
                        <span className="text-[8px] uppercase text-white/40 font-bold block text-left">Jogador 1 (Esquerda)</span>
                        <div className="flex items-center gap-2">
                          <div className="relative w-14 h-14 shrink-0">
                            {playerPhotos.t1p1 ? (
                              <>
                                <img 
                                  src={playerPhotos.t1p1} 
                                  className="w-full h-full rounded-lg object-cover border border-white/20" 
                                  alt="Jogador 1"
                                />
                                <button 
                                  onClick={() => removePhoto('t1p1')}
                                  className="absolute -top-1 -right-1 bg-red-500 hover:bg-red-600 p-0.5 rounded-full text-white transition-all shadow-md cursor-pointer"
                                  title="Remover Foto"
                                >
                                  <Trash2 size={10} />
                                </button>
                              </>
                            ) : (
                              <label className="w-full h-full rounded-lg bg-white/5 border border-dashed border-white/20 flex flex-col items-center justify-center cursor-pointer hover:bg-white/10 hover:border-white/30 transition-all">
                                <Camera size={14} className="text-white/40" />
                                <input 
                                  type="file" 
                                  accept="image/*" 
                                  className="hidden" 
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) handlePhotoUpload('t1p1', file);
                                  }} 
                                />
                              </label>
                            )}
                          </div>
                          <input 
                            type="text" 
                            placeholder="NOME"
                            value={playerNames.t1p1 || ''} 
                            onChange={(e) => handlePlayerNameChange('t1p1', e.target.value)}
                            className="flex-1 min-w-0 bg-black/40 border border-white/5 rounded-lg px-2 py-1.5 text-[10px] font-bold focus:border-[#00FF00] outline-none transition-colors text-white"
                          />
                        </div>
                      </div>

                      {/* Player 2 */}
                      <div className="space-y-1 bg-white/5 p-2 rounded-xl border border-white/5">
                        <span className="text-[8px] uppercase text-white/40 font-bold block text-left">Jogador 2 (Direita)</span>
                        <div className="flex items-center gap-2">
                          <div className="relative w-14 h-14 shrink-0">
                            {playerPhotos.t1p2 ? (
                              <>
                                <img 
                                  src={playerPhotos.t1p2} 
                                  className="w-full h-full rounded-lg object-cover border border-white/20" 
                                  alt="Jogador 2"
                                />
                                <button 
                                  onClick={() => removePhoto('t1p2')}
                                  className="absolute -top-1 -right-1 bg-red-500 hover:bg-red-600 p-0.5 rounded-full text-white transition-all shadow-md cursor-pointer"
                                  title="Remover Foto"
                                >
                                  <Trash2 size={10} />
                                </button>
                              </>
                            ) : (
                              <label className="w-full h-full rounded-lg bg-white/5 border border-dashed border-white/20 flex flex-col items-center justify-center cursor-pointer hover:bg-white/10 hover:border-white/30 transition-all">
                                <Camera size={14} className="text-white/40" />
                                <input 
                                  type="file" 
                                  accept="image/*" 
                                  className="hidden" 
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) handlePhotoUpload('t1p2', file);
                                  }} 
                                />
                              </label>
                            )}
                          </div>
                          <input 
                            type="text" 
                            placeholder="NOME"
                            value={playerNames.t1p2 || ''} 
                            onChange={(e) => handlePlayerNameChange('t1p2', e.target.value)}
                            className="flex-1 min-w-0 bg-black/40 border border-white/5 rounded-lg px-2 py-1.5 text-[10px] font-bold focus:border-[#00FF00] outline-none transition-colors text-white"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Golden Point Toggle */}
                <div className={`flex items-center justify-between p-4 bg-white/5 rounded-2xl ${state.gameMode === 'beach' ? 'opacity-50 pointer-events-none' : ''}`}>
                  <div>
                    <h3 className="font-bold">Ponto de Ouro</h3>
                    <p className="text-xs text-white/40">{state.gameMode === 'beach' ? 'Obrigatório no Beach Tennis' : 'Sem vantagem (Deuce)'}</p>
                  </div>
                  <button 
                    onClick={() => setGoldenPoint(!goldenPoint)}
                    className="w-14 h-8 rounded-full transition-colors relative"
                    style={{ backgroundColor: goldenPoint ? themeColor : 'rgba(255,255,255,0.1)' }}
                  >
                    <motion.div 
                      animate={{ x: goldenPoint ? 24 : 4 }}
                      className="absolute top-1 w-6 h-6 bg-white rounded-full shadow-lg"
                    />
                  </button>
                </div>

                {/* Best Of Sets */}
                <div className="space-y-4">
                  <h3 className="font-bold uppercase text-xs tracking-widest text-white/40">Melhor de</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[1, 3, 5].map((n) => (
                      <button
                        key={n}
                        onClick={() => setBestOf(n)}
                        className="py-4 rounded-2xl font-black transition-all text-xs"
                        style={{ 
                          backgroundColor: bestOf === n ? themeColor : 'rgba(255,255,255,0.05)',
                          color: bestOf === n ? 'black' : 'white'
                        }}
                      >
                        {n} SETS
                      </button>
                    ))}
                    <button
                      onClick={() => setBestOf(0)}
                      className="py-4 rounded-2xl font-black transition-all text-xs flex flex-col items-center justify-center leading-tight"
                      style={{ 
                        backgroundColor: bestOf === 0 ? themeColor : 'rgba(255,255,255,0.05)',
                        color: bestOf === 0 ? 'black' : 'white'
                      }}
                    >
                      <span>TREINO</span>
                      <span className="text-[8px] opacity-60">SET INFINITO</span>
                    </button>
                  </div>
                </div>

                <button 
                  onClick={() => {
                    setMatchCode(null);
                    setIsModeSelected(false);
                    setShowSettings(false);
                  }}
                  className="w-full py-4 bg-red-500/10 text-red-500 font-bold uppercase text-xs tracking-widest rounded-2xl hover:bg-red-500/20 transition-colors"
                >
                  Sair da Partida
                </button>

                <button 
                  onClick={() => {
                    setShowSettings(false);
                    syncToFirestore(state, teamNames, bestOf, goldenPoint);
                  }}
                  className="w-full py-5 bg-white text-black font-black uppercase italic tracking-tighter rounded-2xl transition-colors flex items-center justify-center gap-2 hover:opacity-90"
                  style={{ backgroundColor: 'white' }}
                >
                  <Check size={20} /> Salvar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* History Modal */}
      <AnimatePresence>
        {showHistory && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-xl"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-lg bg-[#111] border border-white/10 rounded-3xl p-8 shadow-2xl flex flex-col max-h-[80vh]"
            >
              <div className="flex justify-between items-center mb-8">
                <div className="flex items-center gap-3">
                  <History size={24} style={{ color: themeColor }} />
                  <h2 className="text-2xl font-black uppercase italic tracking-tighter">Histórico</h2>
                </div>
                <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-white/10 rounded-full">
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
                {finishedMatches.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-white/20">
                    <Calendar size={48} className="mb-4 opacity-10" />
                    <p className="font-bold uppercase tracking-widest text-xs">Nenhuma partida finalizada</p>
                  </div>
                ) : (
                  finishedMatches.map((match) => (
                    <div key={match.id} className="bg-white/5 border border-white/5 rounded-2xl p-4 space-y-3">
                      <div className="flex justify-between items-center text-[10px] uppercase tracking-widest text-white/30 font-bold">
                        <span>{match.date}</span>
                        <span style={{ color: themeColor }}>Finalizada</span>
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <div className="flex-1 space-y-1">
                          <div className="text-sm font-black italic" style={{ color: match.winner === 0 ? '#00FF00' : 'white' }}>
                            {match.teamNames[0]}
                          </div>
                          <div className="text-sm font-black italic" style={{ color: match.winner === 1 ? '#00D2FF' : 'white' }}>
                            {match.teamNames[1]}
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-4 px-4 border-l border-white/10">
                          <div className="flex flex-col items-center">
                            <span className="text-[10px] text-white/20 font-bold">SETS</span>
                            <div className="text-xl font-black italic">
                              <span style={{ color: match.winner === 0 ? '#00FF00' : undefined }}>{match.sets[0]}</span>
                              <span className="mx-1 text-white/20">-</span>
                              <span style={{ color: match.winner === 1 ? '#00D2FF' : undefined }}>{match.sets[1]}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-2 pt-2 border-t border-white/5">
                        {match.setHistory.map((set, i) => (
                          <div key={i} className="bg-black/40 px-2 py-1 rounded text-[10px] font-mono flex gap-1">
                            <span style={{ color: set.t1 > set.t2 ? '#00FF00' : 'rgba(255,255,255,0.4)' }}>{set.t1}</span>
                            <span className="text-white/10">|</span>
                            <span style={{ color: set.t2 > set.t1 ? '#00D2FF' : 'rgba(255,255,255,0.4)' }}>{set.t2}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <button 
                onClick={() => setShowHistory(false)}
                className="w-full mt-8 py-4 bg-white text-black font-black uppercase italic tracking-tighter rounded-2xl transition-colors hover:opacity-90"
              >
                Fechar
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reset Confirmation Modal */}
      <AnimatePresence>
        {showResetConfirm && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/90 backdrop-blur-md"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-xs bg-[#111] border border-white/10 rounded-3xl p-8 shadow-2xl text-center"
            >
              <RotateCcw size={48} className="text-red-500 mx-auto mb-4" />
              <h2 className="text-xl font-black uppercase italic tracking-tighter mb-2">Resetar Partida?</h2>
              <p className="text-sm text-white/40 mb-8">Todo o progresso atual será perdido permanentemente.</p>
              
              <div className="flex flex-col gap-3">
                <button 
                  onClick={confirmReset}
                  className="w-full py-4 bg-red-500 text-white font-black uppercase italic tracking-tighter rounded-2xl hover:bg-red-600 transition-colors"
                >
                  Sim, Resetar
                </button>
                <button 
                  onClick={() => setShowResetConfirm(false)}
                  className="w-full py-4 bg-white/5 text-white font-black uppercase italic tracking-tighter rounded-2xl hover:bg-white/10 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer Hint */}
      <div className="absolute bottom-4 left-0 right-0 flex justify-center pointer-events-none">
        <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-white/20">Toque no lado para pontuar</p>
      </div>
    </div>
  );
}
