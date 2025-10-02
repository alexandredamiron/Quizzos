"use client";

import { useState, useEffect } from "react";
import * as Ably from "ably";
import questionsData from "../data/questions.json";
import natural from "natural";

interface QuestionImage {
  src: string;
  alt: string;
}

interface Question {
  title: string;
  description: string;
  simultaneousPlayers: number;
  images: QuestionImage[];
}

interface GameState {
  textInput: string;
  textareaInput: string;
  numberInput: string;
  flippedCards: boolean[];
  currentPage: number;
  showAnswer: boolean;
  answerRevealed: boolean;
  showOthers: boolean;
  scores: PlayerScore[];
  playerId?: string;
}

interface PlayerData {
  [playerId: string]: {
    textInput: string;
    textareaInput: string;
    numberInput: string;
  };
}

interface PlayerScore {
  playerId: string;
  titleScore: number;
  descriptionScore: number;
  numberScore: number;
  totalScore: number;
}

export default function Home() {
  const questions: Question[] = questionsData;
  const maxPages = questions.length;

  const [playerId, setPlayerId] = useState<string>("");
  const [gameState, setGameState] = useState<GameState>({
    textInput: "",
    textareaInput: "",
    numberInput: "",
    flippedCards: [false, false, false, false],
    currentPage: 1,
    showAnswer: false,
    answerRevealed: false,
    showOthers: false,
    scores: [],
  });
  const [otherPlayers, setOtherPlayers] = useState<PlayerData>({});

  const [ably, setAbly] = useState<Ably.Realtime | null>(null);
  const [channel, setChannel] = useState<Ably.RealtimeChannel | null>(null);

  const currentQuestion = questions[gameState.currentPage - 1];

  useEffect(() => {
    // Generate player ID
    const id = `Player-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    setPlayerId(id);

    // Initialize Ably with basic authentication (using public key for development)
    const ablyClient = new Ably.Realtime({
      key: process.env.NEXT_PUBLIC_ABLY_API_KEY,
      clientId: id, // Set clientId for presence
    });

    const gameChannel = ablyClient.channels.get("quizzos-game");

    // Track if we've already replied to avoid spam
    let hasReplied = false;

    // Enter presence - Ably will automatically detect disconnections
    gameChannel.presence.enter({
      textInput: "",
      textareaInput: "",
      numberInput: "",
    });

    // Listen for presence events
    gameChannel.presence.subscribe("enter", (member) => {
      console.log("Player entered presence:", member.clientId, member.data);
      if (member.clientId && member.clientId !== id) {
        setOtherPlayers((prev) => ({
          ...prev,
          [member.clientId]: member.data,
        }));
      }
    });

    gameChannel.presence.subscribe("update", (member) => {
      console.log("Player updated presence:", member.clientId, member.data);
      if (member.clientId && member.clientId !== id) {
        setOtherPlayers((prev) => ({
          ...prev,
          [member.clientId]: member.data,
        }));
      }
    });

    gameChannel.presence.subscribe("leave", (member) => {
      console.log("Player left presence:", member.clientId);
      if (member.clientId) {
        setOtherPlayers((prev) => {
          const newPlayers = { ...prev };
          delete newPlayers[member.clientId!];
          return newPlayers;
        });
      }
    });

    // Subscribe to card flip updates (shared across all players)
    gameChannel.subscribe("card-flip", (message) => {
      setGameState((prev) => ({ ...prev, flippedCards: message.data }));
    });

    // Subscribe to answer reveal updates (shared across all players)
    gameChannel.subscribe("answer-reveal", (message) => {
      setGameState((prev) => ({
        ...prev,
        showAnswer: message.data.showAnswer,
        answerRevealed: message.data.showAnswer || prev.answerRevealed
      }));
    });

    // Subscribe to show others updates (shared across all players)
    gameChannel.subscribe("show-others", (message) => {
      setGameState((prev) => ({ ...prev, showOthers: message.data.showOthers }));
    });

    // Subscribe to page navigation updates (shared across all players)
    gameChannel.subscribe("page-change", (message) => {
      setGameState((prev) => ({
        ...prev,
        currentPage: message.data.currentPage,
        textInput: "",
        textareaInput: "",
        numberInput: "",
        flippedCards: [false, false, false, false],
        showAnswer: false,
        answerRevealed: false,
        showOthers: false,
        scores: [],
      }));
      // Reset all other players' answers to empty when page changes
      setOtherPlayers((prev) => {
        const resetPlayers: PlayerData = {};
        Object.keys(prev).forEach(playerId => {
          resetPlayers[playerId] = {
            textInput: "",
            textareaInput: "",
            numberInput: "",
          };
        });
        return resetPlayers;
      });
    });

    // Subscribe to player input updates
    gameChannel.subscribe("player-input", (message) => {
      const { playerId: senderId, ...playerData } = message.data;
      if (senderId !== id) {
        setOtherPlayers((prev) => ({
          ...prev,
          [senderId]: playerData,
        }));
      }
    });

    // Subscribe to player join events
    gameChannel.subscribe("player-join", (message) => {
      console.log("Received player-join:", message.data);
      const { playerId: senderId, ...playerData } = message.data;
      if (senderId !== id) {
        console.log("Adding other player:", senderId);
        setOtherPlayers((prev) => ({
          ...prev,
          [senderId]: playerData,
        }));

        // Only reply once per session to avoid rate limiting
        if (!hasReplied) {
          hasReplied = true;
          setTimeout(() => {
            gameChannel.publish("player-join", {
              playerId: id,
              textInput: gameState.textInput,
              textareaInput: gameState.textareaInput,
              numberInput: gameState.numberInput,
            });
            // Reset after 1 second so we can reply to new players
            setTimeout(() => { hasReplied = false; }, 1000);
          }, Math.random() * 1000); // Random delay 0-1000ms
        }
      }
    });

    // Subscribe to player leave events
    gameChannel.subscribe("player-leave", (message) => {
      console.log("Player left:", message.data.playerId);
      const { playerId: senderId } = message.data;
      setOtherPlayers((prev) => {
        const newPlayers = { ...prev };
        delete newPlayers[senderId];
        return newPlayers;
      });
    });

    // Wait for channel to be attached, then announce presence
    gameChannel.on("attached", () => {
      console.log("Channel attached, announcing presence for:", id);
      gameChannel.publish("player-join", {
        playerId: id,
        textInput: "",
        textareaInput: "",
        numberInput: "",
      });
    });

    // Debug connection state
    ablyClient.connection.on("connected", () => {
      console.log("Ably connected!");
    });

    ablyClient.connection.on("failed", (error) => {
      console.error("Ably connection failed:", error);
    });

    setAbly(ablyClient);
    setChannel(gameChannel);

    // Handle window close/unload - announce we're leaving
    const handleBeforeUnload = () => {
      gameChannel.publish("player-leave", { playerId: id });
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    // Cleanup function - announce we're leaving
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      gameChannel.publish("player-leave", { playerId: id });
      gameChannel.unsubscribe();
      ablyClient.close();
    };
  }, []);

  const updateGameState = (updates: Partial<GameState>) => {
    const newState = { ...gameState, ...updates };
    setGameState(newState);

    // Only broadcast input changes via presence, not card flips
    if (updates.textInput !== undefined || updates.textareaInput !== undefined || updates.numberInput !== undefined) {
      channel?.presence.update({
        textInput: newState.textInput,
        textareaInput: newState.textareaInput,
        numberInput: newState.numberInput,
      });
    }
  };

  const handleDisplay = () => {
    const newFlipped = [true, true, true, true];
    setGameState((prev) => ({ ...prev, flippedCards: newFlipped }));
    channel?.publish("card-flip", newFlipped);
  };

  const handleTadaaa = () => {
    const newShowAnswer = !gameState.showAnswer;

    // Calculate scores when showing the answer
    if (newShowAnswer) {
      calculateScores();
    }

    setGameState((prev) => ({
      ...prev,
      showAnswer: newShowAnswer,
      answerRevealed: newShowAnswer || prev.answerRevealed
    }));
    channel?.publish("answer-reveal", { showAnswer: newShowAnswer });
  };

  const handleLesAutres = () => {
    const newShowOthers = true;
    setGameState((prev) => ({ ...prev, showOthers: newShowOthers }));
    channel?.publish("show-others", { showOthers: newShowOthers });
  };

  const maskText = (text: string): string => {
    return text.replace(/[a-zA-Z0-9]/g, '*');
  };

  const calculateTextSimilarity = (text1: string, text2: string): number => {
    if (!text1 || !text2) return 0;

    const TfIdf = natural.TfIdf;
    const tfidf = new TfIdf();

    tfidf.addDocument(text1.toLowerCase());
    tfidf.addDocument(text2.toLowerCase());

    const terms1: { [key: string]: number } = {};
    const terms2: { [key: string]: number } = {};

    tfidf.listTerms(0).forEach((item: any) => {
      terms1[item.term] = item.tfidf;
    });

    tfidf.listTerms(1).forEach((item: any) => {
      terms2[item.term] = item.tfidf;
    });

    // Calculate cosine similarity
    const allTerms = new Set([...Object.keys(terms1), ...Object.keys(terms2)]);
    let dotProduct = 0;
    let magnitude1 = 0;
    let magnitude2 = 0;

    allTerms.forEach(term => {
      const val1 = terms1[term] || 0;
      const val2 = terms2[term] || 0;
      dotProduct += val1 * val2;
      magnitude1 += val1 * val1;
      magnitude2 += val2 * val2;
    });

    if (magnitude1 === 0 || magnitude2 === 0) return 0;

    return dotProduct / (Math.sqrt(magnitude1) * Math.sqrt(magnitude2));
  };

  const calculateNumberScore = (guess: string, actual: number): number => {
    const guessNum = parseFloat(guess);
    if (isNaN(guessNum)) return 0;

    const diff = Math.abs(guessNum - actual);
    if (diff === 0) return 1;

    // More severe scoring - start rewarding at ±30% margin
    const relativeError = diff / actual;

    // No points if error is greater than 30%
    if (relativeError > 0.3) return 0;

    // Score drops from 1.0 at 0% error to 0 at 30% error
    const score = 1 - (relativeError / 0.3);
    return Math.max(0, score);
  };

  const calculateScores = () => {
    const allPlayers = {
      [playerId]: {
        textInput: gameState.textInput,
        textareaInput: gameState.textareaInput,
        numberInput: gameState.numberInput,
      },
      ...otherPlayers,
    };

    const scores: PlayerScore[] = Object.entries(allPlayers).map(([id, data]) => {
      const titleScore = calculateTextSimilarity(data.textInput, currentQuestion.title);
      const descriptionScore = calculateTextSimilarity(data.textareaInput, currentQuestion.description) * 3;
      const numberScore = calculateNumberScore(data.numberInput, currentQuestion.simultaneousPlayers);

      // 40% title, 40% description, 20% number
      const totalScore = (titleScore * 0.40) + (descriptionScore * 0.40) + (numberScore * 0.20);

      return {
        playerId: id,
        titleScore,
        descriptionScore,
        numberScore,
        totalScore,
      };
    });

    // Sort by total score descending
    scores.sort((a, b) => b.totalScore - a.totalScore);

    setGameState((prev) => ({ ...prev, scores }));
  };

  const toggleCard = (index: number) => {
    const newFlipped = [...gameState.flippedCards];
    newFlipped[index] = !newFlipped[index];
    setGameState((prev) => ({ ...prev, flippedCards: newFlipped }));
    channel?.publish("card-flip", newFlipped);
  };

  const handleNextPage = () => {
    if (gameState.currentPage < maxPages) {
      const newPage = gameState.currentPage + 1;
      const resetState = {
        textInput: "",
        textareaInput: "",
        numberInput: "",
        flippedCards: [false, false, false, false],
        currentPage: newPage,
        showAnswer: false,
        answerRevealed: false,
        showOthers: false,
        scores: [],
      };
      setGameState(resetState);
      channel?.publish("page-change", { currentPage: newPage });
      channel?.presence.update({
        textInput: "",
        textareaInput: "",
        numberInput: "",
      });
    }
  };

  const handlePreviousPage = () => {
    if (gameState.currentPage > 1) {
      const newPage = gameState.currentPage - 1;
      const resetState = {
        textInput: "",
        textareaInput: "",
        numberInput: "",
        flippedCards: [false, false, false, false],
        currentPage: newPage,
        showAnswer: false,
        answerRevealed: false,
        showOthers: false,
        scores: [],
      };
      setGameState(resetState);
      channel?.publish("page-change", { currentPage: newPage });
      channel?.presence.update({
        textInput: "",
        textareaInput: "",
        numberInput: "",
      });
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Upper Section - 2/3 of screen */}
      <div className="h-2/3 p-8 flex gap-6">
        {/* Left Sidebar - Player ID */}
        <div className="w-48 flex flex-col gap-4">
          <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-4 border-2 border-purple-500/30">
            <div className="text-purple-300 text-sm font-semibold mb-2">You</div>
            <div className="text-white font-bold text-lg">{playerId}</div>
          </div>
        </div>

        {/* Center - Card Grid */}
        <div className="flex-1 grid grid-cols-2 gap-6 max-w-6xl">
          {currentQuestion.images.map((image, index) => (
            <div
              key={index}
              className="relative group cursor-pointer perspective-1000"
              onClick={() => toggleCard(index)}
            >
              <div
                className={`relative w-full h-full transition-transform duration-700 transform-style-3d ${
                  gameState.flippedCards[index] ? "rotate-y-180" : ""
                }`}
              >
                {/* Front of card */}
                <div className="absolute inset-0 backface-hidden rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-2xl border-4 border-purple-300/30">
                  <div className="text-6xl">🎴</div>
                </div>

                {/* Back of card */}
                <div className="absolute inset-0 backface-hidden rounded-2xl shadow-2xl border-4 border-blue-300/30 rotate-y-180 overflow-hidden">
                  <img
                    src={image.src}
                    alt={image.alt}
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Right Sidebar - Other Players / Answer */}
        <div className="flex-1 max-w-xl flex flex-col gap-4">
          {/* Answer Display */}
          {gameState.answerRevealed && !gameState.showAnswer && (
            <div className="bg-gradient-to-br from-yellow-400/20 via-orange-400/20 to-pink-500/20 backdrop-blur-sm rounded-xl p-4 border-2 border-yellow-400/50">
              <div className="text-yellow-300 text-sm font-semibold mb-3 flex items-center gap-2">
                <span>🎉</span>
                <span>Answer</span>
              </div>
              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-yellow-200/80 text-xs">Title:</div>
                  <div className="text-white font-bold">
                    {gameState.showOthers ? currentQuestion.title : maskText(currentQuestion.title)}
                  </div>
                </div>
                <div>
                  <div className="text-orange-200/80 text-xs">Description:</div>
                  <div className="text-white line-clamp-4">
                    {gameState.showOthers ? currentQuestion.description : maskText(currentQuestion.description)}
                  </div>
                </div>
                <div>
                  <div className="text-pink-200/80 text-xs">Simultaneous Players:</div>
                  <div className="text-white font-bold text-lg">
                    {gameState.showOthers ? currentQuestion.simultaneousPlayers : maskText(String(currentQuestion.simultaneousPlayers))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Other Players */}
          <div className="flex-1">
            <div className="text-purple-300 text-sm font-semibold mb-4">Other Players</div>
            {Object.entries(otherPlayers).length === 0 ? (
              <div className="text-slate-400 text-sm italic">No other players yet...</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 auto-rows-min">
                {Object.entries(otherPlayers).map(([id, data]) => (
                  <div
                    key={id}
                    className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-4 border-2 border-cyan-500/30 h-fit"
                  >
                    <div className="text-cyan-300 font-bold text-sm mb-3">{id}</div>
                    <div className="space-y-2 text-xs">
                      <div>
                        <div className="text-slate-400">Text:</div>
                        <div className="text-white truncate">
                          {gameState.showOthers ? (data.textInput || "-") : (data.textInput ? maskText(data.textInput) : "-")}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400">Description:</div>
                        <div className="text-white line-clamp-8">
                          {gameState.showOthers ? (data.textareaInput || "-") : (data.textareaInput ? maskText(data.textareaInput) : "-")}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400">Number:</div>
                        <div className="text-white">
                          {gameState.showOthers ? (data.numberInput || "-") : (data.numberInput ? maskText(data.numberInput) : "-")}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lower Section - 1/3 of screen */}
      <div className="h-1/3 bg-slate-800/50 backdrop-blur-sm border-t-4 border-purple-500/30 p-6">
        <div className="flex h-full max-w-7xl mx-auto gap-6">
          {/* Page Navigation - Left */}
          <div className="flex flex-col gap-2 justify-center">
            <button
              onClick={handlePreviousPage}
              disabled={gameState.currentPage === 1}
              className="py-2 px-4 rounded-xl bg-gradient-to-r from-slate-600 to-slate-700 hover:from-slate-500 hover:to-slate-600 text-white font-bold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              ← Previous
            </button>
            <div className="text-center text-purple-300 font-semibold">
              Page {gameState.currentPage}
            </div>
            <button
              onClick={handleNextPage}
              disabled={gameState.currentPage === maxPages}
              className="py-2 px-4 rounded-xl bg-gradient-to-r from-slate-600 to-slate-700 hover:from-slate-500 hover:to-slate-600 text-white font-bold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              Next →
            </button>
          </div>

          {/* Left Section - 2/3 - Inputs */}
          <div className="flex-[2] flex gap-4">
            <div className="flex-1 flex flex-col">
              <label className="text-sm font-semibold text-purple-300 mb-2">Text Input</label>
              <input
                type="text"
                value={gameState.textInput}
                onChange={(e) => updateGameState({ textInput: e.target.value })}
                className="flex-1 px-4 py-3 rounded-xl bg-slate-700/50 border-2 border-purple-500/30 focus:border-purple-400 focus:outline-none text-white placeholder-slate-400 transition-all"
                placeholder="Enter text..."
              />
            </div>

            <div className="flex-1 flex flex-col">
              <label className="text-sm font-semibold text-purple-300 mb-2">Description</label>
              <textarea
                value={gameState.textareaInput}
                onChange={(e) => updateGameState({ textareaInput: e.target.value })}
                className="flex-1 px-4 py-3 rounded-xl bg-slate-700/50 border-2 border-purple-500/30 focus:border-purple-400 focus:outline-none text-white placeholder-slate-400 resize-none transition-all"
                placeholder="Enter description..."
              />
            </div>

            <div className="flex-1 flex flex-col">
              <label className="text-sm font-semibold text-purple-300 mb-2">Number</label>
              <input
                type="number"
                value={gameState.numberInput}
                onChange={(e) => updateGameState({ numberInput: e.target.value })}
                className="flex-1 px-4 py-3 rounded-xl bg-slate-700/50 border-2 border-purple-500/30 focus:border-purple-400 focus:outline-none text-white placeholder-slate-400 transition-all"
                placeholder="Enter number..."
              />
            </div>
          </div>

          {/* Right Section - 1/3 - Buttons */}
          <div className="flex-1 flex flex-col gap-4 justify-center">
            <button
              onClick={handleDisplay}
              className="py-4 px-6 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold text-lg shadow-lg hover:shadow-xl transform hover:scale-105 transition-all"
            >
              Display
            </button>
            <button
              onClick={handleLesAutres}
              disabled={gameState.showOthers}
              className="py-4 px-6 rounded-xl bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-bold text-lg shadow-lg hover:shadow-xl transform hover:scale-105 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              Les autres
            </button>
            <button
              onClick={handleTadaaa}
              className="py-4 px-6 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-bold text-lg shadow-lg hover:shadow-xl transform hover:scale-105 transition-all"
            >
              {gameState.showAnswer ? "Hide Answer" : "Tadaaaaaa 🎉"}
            </button>
          </div>
        </div>
      </div>

      {/* Answer Overlay */}
      {gameState.showAnswer && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn">
          <div className="bg-gradient-to-br from-yellow-400 via-orange-400 to-pink-500 p-1 rounded-3xl shadow-2xl max-w-2xl w-full mx-4 animate-scaleIn">
            <div className="bg-slate-900 rounded-3xl p-8">
              <div className="text-center mb-6">
                <div className="text-6xl mb-4">🎉</div>
                <h2 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-pink-500 mb-2">
                  Answer
                </h2>
              </div>

              <div className="space-y-6">
                <div className="bg-slate-800/50 rounded-xl p-6 border-2 border-yellow-400/30">
                  <div className="text-yellow-300 text-sm font-semibold mb-2">Title</div>
                  <div className="text-white text-2xl font-bold">{currentQuestion.title}</div>
                </div>

                <div className="bg-slate-800/50 rounded-xl p-6 border-2 border-orange-400/30">
                  <div className="text-orange-300 text-sm font-semibold mb-2">Description</div>
                  <div className="text-white text-lg leading-relaxed">{currentQuestion.description}</div>
                </div>

                <div className="bg-slate-800/50 rounded-xl p-6 border-2 border-pink-400/30">
                  <div className="text-pink-300 text-sm font-semibold mb-2">Simultaneous Players</div>
                  <div className="text-white text-3xl font-bold">{currentQuestion.simultaneousPlayers}</div>
                </div>
              </div>

              {/* Scores Leaderboard */}
              {gameState.scores.length > 0 && (
                <div className="mt-6 bg-slate-800/50 rounded-xl p-6 border-2 border-purple-400/30">
                  <div className="text-purple-300 text-lg font-semibold mb-4 text-center">🏆 Leaderboard</div>
                  <div className="space-y-3">
                    {gameState.scores.map((score, index) => (
                      <div
                        key={score.playerId}
                        className={`flex items-center justify-between p-3 rounded-lg ${
                          index === 0
                            ? "bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-2 border-yellow-400/50"
                            : "bg-slate-700/50"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="text-2xl">
                            {index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`}
                          </div>
                          <div>
                            <div className={`font-bold ${index === 0 ? "text-yellow-300" : "text-white"}`}>
                              {score.playerId === playerId ? "You" : score.playerId}
                            </div>
                            <div className="text-xs text-slate-400">
                              Title: {(score.titleScore * 0.40 * 100).toFixed(1)} • Desc: {(score.descriptionScore * 0.40 * 100).toFixed(1)} • Num: {(score.numberScore * 0.20 * 100).toFixed(1)}
                            </div>
                          </div>
                        </div>
                        <div className={`text-2xl font-bold ${index === 0 ? "text-yellow-300" : "text-white"}`}>
                          {(score.totalScore * 100).toFixed(1)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={handleTadaaa}
                className="mt-8 w-full py-4 px-6 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold text-lg shadow-lg hover:shadow-xl transform hover:scale-105 transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .perspective-1000 {
          perspective: 1000px;
        }
        .transform-style-3d {
          transform-style: preserve-3d;
        }
        .backface-hidden {
          backface-visibility: hidden;
        }
        .rotate-y-180 {
          transform: rotateY(180deg);
        }
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes scaleIn {
          from {
            transform: scale(0.8);
            opacity: 0;
          }
          to {
            transform: scale(1);
            opacity: 1;
          }
        }
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }
        .animate-scaleIn {
          animation: scaleIn 0.4s ease-out;
        }
      `}</style>
    </div>
  );
}
