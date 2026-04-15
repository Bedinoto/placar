/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RotateCcw, Undo2, Settings, Trophy, X, Check, History, Calendar } from 'lucide-react';
import confetti from 'canvas-confetti';

type Score = 0 | 15 | 30 | 40 | 'AD';

interface MatchState {
  points: [Score, Score];
  games: [number, number];
  sets: [number, number];
  setHistory: [number, number][];
  server: 0 | 1;
  isGameOver: boolean;
  winner: 0 | 1 | null;
}

interface FinishedMatch {
  id: string;
  date: string;
  teamNames: [string, string];
  sets: [number, number];
  setHistory: [number, number][];
  winner: 0 | 1;
}

const POINT_SEQUENCE: Score[] = [0, 15, 30, 40];

const getPointCount = (score: Score): number => {
  if (score === 0) return 0;
  if (score === 15) return 1;
  if (score === 30) return 2;
  if (score === 40) return 3;
  if (score === 'AD') return 4;
  return 0;
};

export default function App() {
  const [state, setState] = useState<MatchState>({
    points: [0, 0],
    games: [0, 0],
    sets: [0, 0],
    setHistory: [],
    server: 0,
    isGameOver: false,
    winner: null,
  });

  const [history, setHistory] = useState<MatchState[]>([]);
  const [finishedMatches, setFinishedMatches] = useState<FinishedMatch[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [goldenPoint, setGoldenPoint] = useState(true);
  const [bestOf, setBestOf] = useState(3);
  const [teamNames, setTeamNames] = useState<[string, string]>(['TIME 1', 'TIME 2']);

  // Save state to history before update
  const updateState = (newState: MatchState) => {
    setHistory((prev) => [...prev, state]);
    setState(newState);
  };

  const undo = () => {
    if (history.length === 0) return;
    const prevState = history[history.length - 1];
    setHistory((prev) => prev.slice(0, -1));
    setState(prevState);
  };

  const reset = () => {
    setShowResetConfirm(true);
  };

  const confirmReset = () => {
    setState({
      points: [0, 0],
      games: [0, 0],
      sets: [0, 0],
      setHistory: [],
      server: 0,
      isGameOver: false,
      winner: null,
    });
    setHistory([]);
    setShowResetConfirm(false);
  };

  const handlePoint = (teamIndex: 0 | 1) => {
    if (state.isGameOver) return;

    const otherIndex = teamIndex === 0 ? 1 : 0;
    const newState = { ...state, points: [...state.points] as [Score, Score] };
    const currentPoint = state.points[teamIndex];
    const otherPoint = state.points[otherIndex];

    // Logic for Padel Scoring
    if (currentPoint === 0) newState.points[teamIndex] = 15;
    else if (currentPoint === 15) newState.points[teamIndex] = 30;
    else if (currentPoint === 30) newState.points[teamIndex] = 40;
    else if (currentPoint === 40) {
      if (goldenPoint) {
        // Golden Point Rule
        winGame(teamIndex);
        return;
      } else {
        // Standard Deuce/Ad Rule
        if (otherPoint === 40) {
          newState.points[teamIndex] = 'AD';
        } else if (otherPoint === 'AD') {
          newState.points[otherIndex] = 40;
        } else {
          winGame(teamIndex);
          return;
        }
      }
    } else if (currentPoint === 'AD') {
      winGame(teamIndex);
      return;
    }

    updateState(newState);
  };

  const winGame = (teamIndex: 0 | 1) => {
    const otherIndex = teamIndex === 0 ? 1 : 0;
    const newState = {
      ...state,
      points: [0, 0] as [Score, Score],
      games: [...state.games] as [number, number],
      server: state.server === 0 ? 1 : 0, // Switch server every game
    };

    newState.games[teamIndex]++;

    // Check for Set Win
    const gamesTeam = newState.games[teamIndex];
    const gamesOther = newState.games[otherIndex];

    if (gamesTeam >= 6 && gamesTeam - gamesOther >= 2) {
      winSet(teamIndex, newState);
    } else if (gamesTeam === 7 && gamesOther === 6) {
      winSet(teamIndex, newState);
    } else {
      updateState(newState);
    }
  };

  const winSet = (teamIndex: 0 | 1, currentState: MatchState) => {
    const newState = {
      ...currentState,
      games: [0, 0] as [number, number],
      sets: [...currentState.sets] as [number, number],
      setHistory: [...currentState.setHistory, [...currentState.games] as [number, number]],
    };

    newState.sets[teamIndex]++;

    // Check for Match Win
    const setsToWin = Math.ceil(bestOf / 2);
    if (newState.sets[teamIndex] >= setsToWin) {
      newState.isGameOver = true;
      newState.winner = teamIndex;
      
      // Save to finished matches
      const finishedMatch: FinishedMatch = {
        id: Date.now().toString(),
        date: new Date().toLocaleString('pt-BR'),
        teamNames: [...teamNames] as [string, string],
        sets: [...newState.sets] as [number, number],
        setHistory: [...newState.setHistory],
        winner: teamIndex,
      };
      setFinishedMatches(prev => [finishedMatch, ...prev]);

      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#00FF00', '#FFFFFF', '#000000']
      });
    }

    updateState(newState);
  };

  return (
    <div className="fixed inset-0 bg-[#050505] text-white font-sans overflow-hidden select-none">
      {/* Header / Stats */}
      <div className="absolute top-0 left-0 right-0 h-16 flex items-center justify-between px-6 border-b border-white/10 bg-black/50 backdrop-blur-md z-20">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold tracking-tighter uppercase italic text-[#00FF00]">Padel Score</h1>
          <div className="flex gap-2">
            {state.setHistory.map((set, i) => (
              <div key={i} className="flex gap-1 bg-white/5 px-2 py-1 rounded text-xs font-mono">
                <span className={set[0] > set[1] ? 'text-[#00FF00]' : 'text-white/40'}>{set[0]}</span>
                <span className="text-white/20">|</span>
                <span className={set[1] > set[0] ? 'text-[#00FF00]' : 'text-white/40'}>{set[1]}</span>
              </div>
            ))}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowHistory(true)}
            className="p-2 hover:bg-white/10 rounded-full transition-colors text-[#00FF00]"
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
          <button 
            onClick={() => setShowSettings(true)}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
          >
            <Settings size={20} />
          </button>
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
        {[0, 1].map((teamIndex) => (
          <div 
            key={teamIndex}
            onClick={() => handlePoint(teamIndex as 0 | 1)}
            className={`relative flex-1 flex flex-col items-center justify-center cursor-pointer transition-all duration-300 active:scale-[0.98] ${
              teamIndex === 0 ? 'border-r border-white/10' : ''
            } hover:bg-white/[0.02]`}
          >
            {/* Server Indicator */}
            <div className="absolute top-8 flex flex-col items-center gap-2">
               <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/40">{teamNames[teamIndex]}</span>
               {state.server === teamIndex && !state.isGameOver && (
                 <motion.div 
                   layoutId="server"
                   className="w-2 h-2 bg-[#00FF00] rounded-full shadow-[0_0_10px_#00FF00]"
                 />
               )}
            </div>

            {/* Sets & Games */}
            <div className="absolute top-24 flex gap-8 items-center">
              <div className="flex flex-col items-center">
                <span className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Sets</span>
                <span className="text-4xl font-black italic">{state.sets[teamIndex]}</span>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Games</span>
                <span className="text-4xl font-black italic text-[#00FF00]">{state.games[teamIndex]}</span>
              </div>
            </div>

            {/* Points */}
            <motion.div 
              key={state.points[teamIndex]}
              initial={{ scale: 0.8, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              className="text-[15vw] sm:text-[20vw] font-black tracking-tighter leading-none italic select-none"
            >
              {state.points[teamIndex]}
            </motion.div>

            {/* Serving Side Indicator (Padel Ball) */}
            {state.server === teamIndex && !state.isGameOver && (
              <div className="absolute bottom-20 w-full px-12 flex justify-between pointer-events-none">
                <AnimatePresence mode="wait">
                  {(getPointCount(state.points[0]) + getPointCount(state.points[1])) % 2 === 0 ? (
                    <motion.div 
                      key="right"
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      className="ml-auto w-8 h-8 bg-[#ccff00] rounded-full shadow-[0_0_15px_#ccff00] border-2 border-black/20 flex items-center justify-center"
                    >
                      <div className="w-full h-[1px] bg-black/10 rotate-45" />
                      <div className="w-full h-[1px] bg-black/10 -rotate-45 absolute" />
                    </motion.div>
                  ) : (
                    <motion.div 
                      key="left"
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      className="mr-auto w-8 h-8 bg-[#ccff00] rounded-full shadow-[0_0_15px_#ccff00] border-2 border-black/20 flex items-center justify-center"
                    >
                      <div className="w-full h-[1px] bg-black/10 rotate-45" />
                      <div className="w-full h-[1px] bg-black/10 -rotate-45 absolute" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Winner Overlay */}
            {state.isGameOver && state.winner === teamIndex && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute inset-0 bg-[#00FF00]/10 flex flex-col items-center justify-center backdrop-blur-sm"
              >
                <Trophy size={80} className="text-[#00FF00] mb-4" />
                <span className="text-4xl font-black uppercase italic tracking-tighter">Winner</span>
              </motion.div>
            )}
          </div>
        ))}
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
              className="w-full max-w-md bg-[#111] border border-white/10 rounded-3xl p-8 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-2xl font-black uppercase italic tracking-tighter">Configurações</h2>
                <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-white/10 rounded-full">
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-8">
                {/* Team Names */}
                <div className="space-y-4">
                  <h3 className="font-bold uppercase text-xs tracking-widest text-white/40">Nomes dos Times</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase text-white/30">Time 1</label>
                      <input 
                        type="text" 
                        value={teamNames[0]} 
                        onChange={(e) => setTeamNames([e.target.value.toUpperCase(), teamNames[1]])}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm font-bold focus:border-[#00FF00] outline-none transition-colors"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase text-white/30">Time 2</label>
                      <input 
                        type="text" 
                        value={teamNames[1]} 
                        onChange={(e) => setTeamNames([teamNames[0], e.target.value.toUpperCase()])}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm font-bold focus:border-[#00FF00] outline-none transition-colors"
                      />
                    </div>
                  </div>
                </div>

                {/* Golden Point Toggle */}
                <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl">
                  <div>
                    <h3 className="font-bold">Ponto de Ouro</h3>
                    <p className="text-xs text-white/40">Sem vantagem (Deuce)</p>
                  </div>
                  <button 
                    onClick={() => setGoldenPoint(!goldenPoint)}
                    className={`w-14 h-8 rounded-full transition-colors relative ${goldenPoint ? 'bg-[#00FF00]' : 'bg-white/10'}`}
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
                  <div className="grid grid-cols-3 gap-3">
                    {[1, 3, 5].map((n) => (
                      <button
                        key={n}
                        onClick={() => setBestOf(n)}
                        className={`py-4 rounded-2xl font-black transition-all ${
                          bestOf === n ? 'bg-[#00FF00] text-black' : 'bg-white/5 text-white'
                        }`}
                      >
                        {n} SETS
                      </button>
                    ))}
                  </div>
                </div>

                <button 
                  onClick={() => setShowSettings(false)}
                  className="w-full py-5 bg-white text-black font-black uppercase italic tracking-tighter rounded-2xl hover:bg-[#00FF00] transition-colors flex items-center justify-center gap-2"
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
                  <History className="text-[#00FF00]" size={24} />
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
                        <span className="text-[#00FF00]">Finalizada</span>
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <div className="flex-1 space-y-1">
                          <div className={`text-sm font-black italic ${match.winner === 0 ? 'text-[#00FF00]' : 'text-white'}`}>
                            {match.teamNames[0]}
                          </div>
                          <div className={`text-sm font-black italic ${match.winner === 1 ? 'text-[#00FF00]' : 'text-white'}`}>
                            {match.teamNames[1]}
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-4 px-4 border-l border-white/10">
                          <div className="flex flex-col items-center">
                            <span className="text-[10px] text-white/20 font-bold">SETS</span>
                            <div className="text-xl font-black italic">
                              <span className={match.winner === 0 ? 'text-[#00FF00]' : ''}>{match.sets[0]}</span>
                              <span className="mx-1 text-white/20">-</span>
                              <span className={match.winner === 1 ? 'text-[#00FF00]' : ''}>{match.sets[1]}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-2 pt-2 border-t border-white/5">
                        {match.setHistory.map((set, i) => (
                          <div key={i} className="bg-black/40 px-2 py-1 rounded text-[10px] font-mono flex gap-1">
                            <span className={set[0] > set[1] ? 'text-[#00FF00]' : 'text-white/40'}>{set[0]}</span>
                            <span className="text-white/10">|</span>
                            <span className={set[1] > set[0] ? 'text-[#00FF00]' : 'text-white/40'}>{set[1]}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <button 
                onClick={() => setShowHistory(false)}
                className="w-full mt-8 py-4 bg-white text-black font-black uppercase italic tracking-tighter rounded-2xl hover:bg-[#00FF00] transition-colors"
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
