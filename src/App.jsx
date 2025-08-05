import React, { useState, useEffect, useMemo, memo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, BarChart, Bar, Cell, AreaChart, Area
} from 'recharts';
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from "firebase/auth";
import { getFirestore, doc, onSnapshot, setDoc, getDoc } from "firebase/firestore";


// --- CONSTANTS & CONFIG ---
const DAY_NAME_MAPPING = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TRADES_PER_PAGE = 20;
const SESSION_KEY = 'proTraderAccessCode';
const DB_COLLECTION_NAME = 'pro_trader_journals';

// --- FIREBASE CONFIG (placeholders, will be handled by environment) ---
// IMPORTANT FOR DEPLOYMENT (e.g., on Vercel):
// This app is designed to get its Firebase configuration from the environment it runs in.
// In the development canvas, `__firebase_config` and `__app_id` are provided automatically.
// For a production deployment on a platform like Vercel, you must provide these
// as environment variables or replace the placeholder logic below with your actual Firebase config object,
// as the injected variables will not be present.
//
// Example of direct replacement (less secure, use environment variables if possible):
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
  };
  
  const appId = import.meta.env.VITE_APP_ID || 'pro-trader-journal';
// const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
// const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';


// --- HELPER FUNCTIONS ---
const formatCurrencyPrecise = (value) => `₹${(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatCurrencyCompact = (value) => {
    const num = value || 0;
    if (Math.abs(num) >= 10000000) return `₹${(num / 10000000).toFixed(2)}Cr`;
    if (Math.abs(num) >= 100000) return `₹${(num / 100000).toFixed(2)}L`;
    return `₹${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const formatPercentage = (value) => `${(value || 0).toFixed(2)}%`;
const formatDateForAxis = (tickItem) => {
    const date = new Date(tickItem);
    return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
};
const generateUniqueId = () => `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const generateSampleTrades = (count, initialCapital) => {
    const trades = [];
    let currentDate = new Date();
    currentDate.setDate(currentDate.getDate() - 90);
    for (let i = 0; i < count; i++) {
        currentDate.setDate(currentDate.getDate() + 1);
        if (currentDate.getDay() === 0 || currentDate.getDay() === 6) { i--; continue; }
        const isProfit = Math.random() > 0.45;
        const pnlMagnitude = isProfit ? Math.random() * 25000 : Math.random() * 15000;
        const grossPnl = isProfit ? pnlMagnitude : -pnlMagnitude;
        const taxesAndCharges = Math.abs(grossPnl) * (Math.random() * 0.05 + 0.02);
        trades.push({
            id: generateUniqueId(),
            date: currentDate.toISOString().split('T')[0],
            day: DAY_NAME_MAPPING[currentDate.getDay()],
            grossPnl: parseFloat(grossPnl.toFixed(2)),
            taxesAndCharges: parseFloat(taxesAndCharges.toFixed(2)),
            capitalDeployed: initialCapital,
            notes: isProfit ? 'Good entry based on trend.' : 'Stopped out, risk managed.'
        });
    }
    return trades;
};


// --- CORE ANALYTICS LOGIC ---
const calculateAnalytics = (currentTrades, journalInitialCapital = 0) => {
  if (!currentTrades || currentTrades.length === 0) {
    return {
      startingCapital: journalInitialCapital, averageCapital: journalInitialCapital, overallPnl: 0, currentEquity: journalInitialCapital, roi: 0,
      totalTrades: 0, winDays: 0, lossDays: 0, winRate: 0, avgProfitOnWinDays: 0, avgLossOnLossDays: 0,
      maxProfit: 0, maxLoss: 0, maxWinningStreak: 0, maxLosingStreak: 0, maxDrawdown: 0, maxDDPercentage: 0,
      expectancy: 0, winLossRatio: 0, profitFactor: 0, capitalFlows: [],
      pnlByDayOfWeek: DAY_NAME_MAPPING.map(day => ({ day: day.substring(0,3), pnl: 0 })),
      monthlyPerformance: [], dailyPnlData: [], pnlDistribution: [],
    };
  }

  const sortedTrades = [...currentTrades].sort((a, b) => new Date(a.date) - new Date(b.date));
  const calculatedTrades = sortedTrades.map(trade => ({
    ...trade,
    netPnl: (trade.grossPnl || 0) - (trade.taxesAndCharges || 0),
    capitalDeployed: parseFloat(trade.capitalDeployed) || 0
  }));

  const winningTrades = calculatedTrades.filter(t => t.netPnl > 0);
  const losingTrades = calculatedTrades.filter(t => t.netPnl < 0);
  const totalTradesCount = calculatedTrades.length;
  const totalWinDays = winningTrades.length;
  const totalLossDays = losingTrades.length;
  const winRate = totalTradesCount > 0 ? (totalWinDays / totalTradesCount) * 100 : 0;
  const totalProfitOnWinDays = winningTrades.reduce((sum, t) => sum + t.netPnl, 0);
  const totalLossOnLossDays = losingTrades.reduce((sum, t) => sum + t.netPnl, 0);
  const avgProfitOnWinDays = totalWinDays > 0 ? totalProfitOnWinDays / totalWinDays : 0;
  const avgLossOnLossDays = totalLossDays > 0 ? totalLossOnLossDays / totalLossDays : 0;
  const profitFactor = Math.abs(totalLossOnLossDays) > 0 ? Math.abs(totalProfitOnWinDays / totalLossOnLossDays) : 0;
  const expectancy = ((winRate / 100) * avgProfitOnWinDays) + (((100 - winRate) / 100) * avgLossOnLossDays);
  const winLossRatio = Math.abs(avgLossOnLossDays) > 0 ? Math.abs(avgProfitOnWinDays / avgLossOnLossDays) : 0;
  const maxProfit = Math.max(0, ...winningTrades.map(t => t.netPnl));
  const maxLoss = Math.min(0, ...losingTrades.map(t => t.netPnl));

  let currentWinStreak = 0, longestWinStreak = 0, currentLossStreak = 0, longestLossStreak = 0;
  calculatedTrades.forEach(trade => {
    if (trade.netPnl > 0) { currentWinStreak++; currentLossStreak = 0; longestWinStreak = Math.max(longestWinStreak, currentWinStreak); }
    else if (trade.netPnl < 0) { currentLossStreak++; currentWinStreak = 0; longestLossStreak = Math.max(longestLossStreak, currentLossStreak); }
    else { currentWinStreak = 0; currentLossStreak = 0; }
  });

  const startingCapital = calculatedTrades.length > 0 ? calculatedTrades[0].capitalDeployed : journalInitialCapital;
  const totalNetPnl = calculatedTrades.reduce((sum, t) => sum + t.netPnl, 0);
  const averageCapital = calculatedTrades.length > 0 ? calculatedTrades.reduce((sum, t) => sum + t.capitalDeployed, 0) / calculatedTrades.length : journalInitialCapital;
  const roi = averageCapital > 0 ? (totalNetPnl / averageCapital) * 100 : 0;

  let runningEquity = 0;
  let peakEquity = -Infinity;
  let maxDrawdownValue = 0;
  const dailyPnlData = [];
  const capitalFlows = [];
  for (let i = 0; i < calculatedTrades.length; i++) {
    const trade = calculatedTrades[i];
    let capitalChange = 0;
    if (i === 0) {
      runningEquity = trade.capitalDeployed + trade.netPnl;
    } else {
      capitalChange = trade.capitalDeployed - calculatedTrades[i-1].capitalDeployed;
      runningEquity += capitalChange + trade.netPnl;
    }
    
    if (capitalChange !== 0) {
        capitalFlows.push({
            date: trade.date,
            type: capitalChange > 0 ? 'Deposit' : 'Withdrawal',
            amount: Math.abs(capitalChange),
            newTotal: trade.capitalDeployed
        });
    }

    peakEquity = Math.max(peakEquity, runningEquity);
    const drawdown = peakEquity - runningEquity;
    maxDrawdownValue = Math.max(maxDrawdownValue, drawdown);
    dailyPnlData.push({ date: trade.date, pnl: trade.netPnl, equity: runningEquity, capital: trade.capitalDeployed });
  }
  const currentEquity = calculatedTrades.length > 0 ? runningEquity : journalInitialCapital;
  const maxDDPercentage = peakEquity > 0 ? (maxDrawdownValue / peakEquity) * 100 : 0;

  const pnlByDayOfWeekMap = calculatedTrades.reduce((acc, t) => {
    const dayName = new Date(t.date).toLocaleDateString('en-US', { weekday: 'long' });
    acc[dayName] = (acc[dayName] || 0) + t.netPnl; return acc; }, {});
  const pnlByDayOfWeek = DAY_NAME_MAPPING.map(day => ({ day: day.substring(0, 3), pnl: pnlByDayOfWeekMap[day] || 0 }));
  
  const monthlyData = calculatedTrades.reduce((acc, trade) => {
    const month = new Date(trade.date).toLocaleString('default', { month: 'short', year: 'numeric' });
    if (!acc[month]) acc[month] = { netPnl: 0, capitals: [], date: new Date(trade.date) };
    acc[month].netPnl += trade.netPnl;
    acc[month].capitals.push(trade.capitalDeployed);
    return acc;
  }, {});
  const monthlyPerformance = Object.keys(monthlyData).map(month => {
      const monthInfo = monthlyData[month];
      const avgCapitalForMonth = monthInfo.capitals.reduce((a, b) => a + b, 0) / monthInfo.capitals.length;
      const monthlyReturn = avgCapitalForMonth > 0 ? (monthInfo.netPnl / monthInfo.capitals.length) * 100 : 0;
      return { month, netPnl: monthInfo.netPnl, capitalDeployed: avgCapitalForMonth, monthlyReturn, date: monthInfo.date };
    }).sort((a, b) => a.date - b.date);
    
  const pnlBuckets = [
    { range: '< -10k', min: -Infinity, max: -10000, count: 0, color: '#be123c' },
    { range: '-10k to -5k', min: -10000, max: -5000, count: 0, color: '#ef4444' },
    { range: '-5k to 0', min: -5000, max: -0.01, count: 0, color: '#f87171' },
    { range: '0 to 5k', min: 0, max: 5000, count: 0, color: '#a7f3d0' },
    { range: '5k to 10k', min: 5000, max: 10000, count: 0, color: '#34d399' },
    { range: '> 10k', min: 10000, max: Infinity, count: 0, color: '#059669' },
  ];
  calculatedTrades.forEach(t => { const bucket = pnlBuckets.find(b => t.netPnl >= b.min && t.netPnl < b.max); if (bucket) bucket.count++; });

  return {
    startingCapital, averageCapital, overallPnl: totalNetPnl, currentEquity, roi, totalTrades: totalTradesCount,
    winDays: totalWinDays, lossDays: totalLossDays, winRate, avgProfitOnWinDays, avgLossOnLossDays, maxProfit, maxLoss,
    maxWinningStreak: longestWinStreak, maxLosingStreak: longestLossStreak, maxDrawdown: maxDrawdownValue,
    maxDDPercentage, expectancy, winLossRatio, profitFactor, pnlByDayOfWeek, monthlyPerformance, dailyPnlData,
    pnlDistribution: pnlBuckets.map(b => ({ name: b.range, trades: b.count, fill: b.color })),
  };
};


// --- UI COMPONENTS ---
const MemoizedMetricCard = memo(({ title, value, colorClass = 'text-gray-200' }) => (
  <div className="bg-gray-800/50 p-4 rounded-lg text-center transition-all duration-300 ease-in-out hover:bg-gray-700/50 transform hover:scale-105 hover:shadow-lg hover:shadow-teal-500/20">
    <h3 className="text-sm text-gray-400 mb-1">{title}</h3>
    <p className={`text-xl lg:text-2xl font-bold ${colorClass}`}>{value}</p>
  </div>
));

const LoginScreen = ({ onLogin, setModal, setView, db }) => {
    const [code, setCode] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        if (!code) {
            setModal({ isOpen: true, type: 'alert', message: 'Please enter an access code.' });
            setIsLoading(false);
            return;
        }
        await onLogin(code);
        setIsLoading(false);
    };

    return (
        <div className="min-h-screen bg-gray-950 flex flex-col justify-center items-center p-4 text-gray-100 font-sans">
            <div className="w-full max-w-md">
                <header className="text-center mb-8">
                    <h1 className="text-3xl md:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-teal-300 to-cyan-500 tracking-wide">PRO TRADER JOURNAL</h1>
                    <p className="text-teal-400/80 mt-2 text-xs md:text-sm tracking-widest">ALGO PULSE ASSET MANAGEMENT PRIVATE LIMITED</p>
                </header>
                <div className="bg-gray-900 border border-teal-800/50 rounded-2xl shadow-2xl p-8">
                    <h2 className="text-xl font-bold text-center text-teal-400 mb-6">Login to Your Journal</h2>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <input 
                            type="password" 
                            placeholder="Access Code" 
                            value={code} 
                            onChange={(e) => setCode(e.target.value)} 
                            className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-white text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-teal-500" 
                            required 
                        />
                        <button type="submit" disabled={isLoading} className="w-full p-3 bg-teal-500 text-white font-bold rounded-lg hover:bg-teal-600 transition disabled:bg-gray-500">
                            {isLoading ? 'Verifying...' : 'Login'}
                        </button>
                    </form>
                    <p className="text-center text-gray-400 mt-6">
                        Don't have an account?{' '}
                        <button onClick={() => setView('register')} className="font-semibold text-teal-400 hover:text-teal-300">
                            Register Here
                        </button>
                    </p>
                </div>
            </div>
        </div>
    );
};

const RegisterScreen = ({ setView, setRegistrationDetails, db, setModal }) => {
    const [accessCode, setAccessCode] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsLoading(true);

        // Check for database connection first
        if (!db) {
            setModal({ isOpen: true, type: 'alert', message: 'Database connection not available. This can happen if Firebase configuration is missing for deployment. Please contact support.' });
            setIsLoading(false);
            return;
        }

        const trimmedCode = accessCode.trim();

        if (!trimmedCode) {
            setModal({ isOpen: true, type: 'alert', message: 'Please enter a desired access code.' });
            setIsLoading(false);
            return;
        }
        
        if (trimmedCode.length < 5) {
            setModal({ isOpen: true, type: 'alert', message: 'Access Code must be at least 5 characters.' });
            setIsLoading(false);
            return;
        }

        try {
            const docRef = doc(db, 'artifacts', appId, 'public', 'data', DB_COLLECTION_NAME, trimmedCode);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                setModal({ isOpen: true, type: 'alert', message: 'This access code is already taken. Please choose another one.' });
            } else {
                setRegistrationDetails({ accessCode: trimmedCode });
                setView('plans');
            }
        } catch (error) {
            console.error("Error checking access code:", error);
            setModal({ isOpen: true, type: 'alert', message: 'An error occurred while checking the access code. Please try again.' });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-950 flex flex-col justify-center items-center p-4 text-gray-100 font-sans">
            <div className="w-full max-w-md">
                 <header className="text-center mb-8">
                    <h1 className="text-3xl md:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-teal-300 to-cyan-500 tracking-wide">Create Your Account</h1>
                </header>
                <div className="bg-gray-900 border border-teal-800/50 rounded-2xl shadow-2xl p-8">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <input type="text" placeholder="Desired Access Code (min 5 characters)" value={accessCode} onChange={e => setAccessCode(e.target.value)} className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-white" required />
                        <button type="submit" disabled={isLoading} className="w-full p-3 bg-teal-500 text-white font-bold rounded-lg hover:bg-teal-600 transition disabled:bg-gray-500">
                            {isLoading ? 'Checking...' : 'Proceed to Plans'}
                        </button>
                    </form>
                     <p className="text-center text-gray-400 mt-6">
                        Already have an account?{' '}
                        <button onClick={() => setView('login')} className="font-semibold text-teal-400 hover:text-teal-300">
                            Login
                        </button>
                    </p>
                </div>
            </div>
        </div>
    );
};

const PlansScreen = ({ registrationDetails, handlePlanActivation }) => {
    const features = [
        { icon: '☁️', title: 'Real-Time Cloud Sync', description: 'Your journal is always up-to-date on all your devices. Log a trade on your desktop and review it instantly on your phone.' },
        { icon: '📊', title: 'Comprehensive Analytics', description: 'Go beyond P&L. Track over 20 key metrics including your Equity Curve, Max Drawdown, Profit Factor, and Win Rate to find your true edge.' },
        { icon: '📚', title: 'Unlimited Journals & Trades', description: 'Whether you trade one strategy or ten, create specialized journals for each and log every single trade without limits.' },
        { icon: '📈', title: 'Performance Visualizations', description: 'Visualize your success. Deep-dive into your data with interactive charts for Daily P&L, P&L by Day of the Week, and more.' },
        { icon: '📝', title: 'Detailed Note-Taking', description: 'Record your strategy, market conditions, and mindset for every trade. Learn from your mistakes and reinforce winning habits.' },
        { icon: '📄', title: 'Data Export', description: 'Your data is yours. Easily export your entire trade history to CSV for further analysis in Excel or other tools.' },
        { icon: '🚀', title: 'Lifetime Access & Updates', description: 'This is not a subscription. One single payment grants you lifetime access to all current and future features.' },
    ];

    return (
        <div className="min-h-screen bg-gray-950 flex flex-col justify-center items-center p-4 sm:p-6 lg:p-8 text-gray-100 font-sans">
            <div className="w-full max-w-2xl mx-auto">
                 <header className="text-center mb-10">
                    <h1 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-teal-300 to-cyan-500 tracking-wide">Unlock Your Trading Edge</h1>
                    <p className="text-teal-400/80 mt-2 text-lg">Your chosen access code: <span className="font-bold text-white">{registrationDetails.accessCode}</span></p>
                </header>
                <div className="bg-gray-900 border-2 border-teal-500 rounded-2xl shadow-2xl p-8">
                    <div className="text-center">
                        <h2 className="text-3xl font-bold text-teal-400">Pro Trader Journal</h2>
                        <p className="text-6xl font-bold my-4">FREE</p>
                        <p className="text-gray-400 mb-8 text-lg">Get <span className="text-teal-400 font-semibold">LIFETIME</span> access, completely free.</p>
                    </div>
                    <div className="border-t border-gray-700 my-8"></div>
                    <ul className="space-y-6 text-left text-gray-300 mb-8">
                        {features.map(feature => (
                                <li key={feature.title} className="flex items-start">
                                    <span className="text-2xl mr-4 mt-1">{feature.icon}</span>
                                    <div>
                                        <h3 className="font-semibold text-white text-lg">{feature.title}</h3>
                                        <p className="text-gray-400">{feature.description}</p>
                                    </div>
                                </li>
                            ))}
                    </ul>
                    <button onClick={handlePlanActivation} className="w-full p-4 bg-teal-500 text-white font-bold rounded-lg hover:bg-teal-600 transition text-lg shadow-lg">
                        Activate My Free Plan
                    </button>
                </div>
            </div>
        </div>
    );
};


const PerformanceCalendar = memo(({ dailyPnlData, onDayClick }) => {
    const [tooltip, setTooltip] = useState({ show: false, x: 0, y: 0, content: null });

    const { weeks, months, maxAbsPnl } = useMemo(() => {
        const today = new Date();
        const endDate = new Date(today);
        const startDate = new Date(today);
        startDate.setDate(startDate.getDate() - 89); // 90 days total

        const pnlMap = new Map(dailyPnlData.map(d => [d.date, d.pnl]));
        let maxAbsPnlValue = 0;

        const days = [];
        let currentDate = new Date(startDate);
        while (currentDate <= endDate) {
            const dateStr = currentDate.toISOString().split('T')[0];
            const pnl = pnlMap.get(dateStr);
            if (pnl !== undefined) {
                maxAbsPnlValue = Math.max(maxAbsPnlValue, Math.abs(pnl));
            }
            days.push({ date: dateStr, pnl: pnl, dayOfWeek: currentDate.getDay() });
            currentDate.setDate(currentDate.getDate() + 1);
        }
        
        const weeksData = [];
        if (days.length > 0) {
            let currentWeek = Array(7).fill(null);
            days.forEach(day => {
                currentWeek[day.dayOfWeek] = day;
                if (day.dayOfWeek === 6) {
                    weeksData.push(currentWeek);
                    currentWeek = Array(7).fill(null);
                }
            });
            if (currentWeek.some(d => d !== null)) weeksData.push(currentWeek);
        }
        
        const monthLabels = [];
        let lastMonth = -1;
        weeksData.forEach((week, weekIndex) => {
            const firstDayOfWeek = week.find(d => d);
            if (firstDayOfWeek) {
                const month = new Date(firstDayOfWeek.date).getMonth();
                if (month !== lastMonth) {
                    monthLabels.push({ label: new Date(firstDayOfWeek.date).toLocaleString('default', { month: 'short' }), weekIndex });
                    lastMonth = month;
                }
            }
        });

        return { weeks: weeksData, months: monthLabels, maxAbsPnl: maxAbsPnlValue || 1 };
    }, [dailyPnlData]);

    const getDayColor = (pnl) => {
        if (pnl === undefined || pnl === null) return 'rgba(55, 65, 81, 0.5)'; // bg-gray-700/50
        if (pnl === 0) return 'rgba(107, 114, 128, 1)'; // bg-gray-500

        const intensity = Math.min(Math.abs(pnl) / maxAbsPnl, 1) * 0.8 + 0.2; // Scale from 0.2 to 1
        if (pnl > 0) return `rgba(52, 211, 153, ${intensity})`; // green-400 with variable opacity
        return `rgba(239, 68, 68, ${intensity})`; // red-500 with variable opacity
    };

    const handleMouseEnter = (e, day) => {
        if (!day || day.pnl === undefined) return;
        setTooltip({
            show: true,
            x: e.target.offsetLeft - 40,
            y: e.target.offsetTop - 55,
            content: (
                <>
                    <p className="font-bold">{day.date}</p>
                    <p className={day.pnl >= 0 ? 'text-green-400' : 'text-red-400'}>{formatCurrencyPrecise(day.pnl)}</p>
                </>
            ),
        });
    };

    const handleMouseLeave = () => setTooltip({ ...tooltip, show: false });

    return (
        <div className="bg-gray-800/40 p-5 rounded-xl shadow-lg border border-gray-700/70 relative">
            {tooltip.show && (
                <div style={{ top: `${tooltip.y}px`, left: `${tooltip.x}px` }} className="absolute z-10 p-2 bg-gray-900 border border-teal-700 text-white text-sm rounded-lg shadow-xl pointer-events-none transition-opacity duration-200">
                    {tooltip.content}
                </div>
            )}
            <h2 className="text-2xl font-bold text-teal-400 mb-4">Performance Heatmap (Last 90 Days)</h2>
            <div className="flex gap-1 overflow-x-auto pb-4">
                <div className="flex flex-col gap-1 text-xs text-gray-400 pr-2 pt-5">
                    <div className="h-4 flex items-center">Mon</div><div className="h-4"></div>
                    <div className="h-4 flex items-center">Wed</div><div className="h-4"></div>
                    <div className="h-4 flex items-center">Fri</div><div className="h-4"></div>
                </div>
                <div className="relative">
                    <div className="flex gap-1">
                        {weeks.map((week, weekIndex) => (
                            <div key={weekIndex} className="flex flex-col gap-1">
                                {week.map((day, dayIndex) => (
                                    <div 
                                        key={day ? day.date : `empty-${weekIndex}-${dayIndex}`}
                                        className="w-4 h-4 rounded-sm cursor-pointer transition-transform duration-150 hover:scale-125 hover:ring-2 hover:ring-teal-400"
                                        style={{ backgroundColor: day ? getDayColor(day.pnl) : 'transparent' }}
                                        onMouseEnter={(e) => handleMouseEnter(e, day)}
                                        onMouseLeave={handleMouseLeave}
                                        onClick={() => onDayClick && onDayClick(day?.date)}
                                    />
                                ))}
                            </div>
                        ))}
                    </div>
                    <div className="absolute -top-5 left-0 flex">
                        {months.map(({label, weekIndex}) => (
                            <div key={label} className="text-xs text-gray-400" style={{position: 'absolute', left: `${weekIndex * 1.25}rem`}}>{label}</div>
                        ))}
                    </div>
                </div>
            </div>
            <div className="flex items-center justify-center mt-4 gap-2 text-xs text-gray-400">
                <span>Loss</span>
                <div className="flex rounded-sm overflow-hidden">
                    <div className="w-4 h-4" style={{backgroundColor: getDayColor(-maxAbsPnl * 0.9)}}></div>
                    <div className="w-4 h-4" style={{backgroundColor: getDayColor(-maxAbsPnl * 0.4)}}></div>
                    <div className="w-4 h-4" style={{backgroundColor: getDayColor(0)}}></div>
                    <div className="w-4 h-4" style={{backgroundColor: getDayColor(maxAbsPnl * 0.4)}}></div>
                    <div className="w-4 h-4" style={{backgroundColor: getDayColor(maxAbsPnl * 0.9)}}></div>
                </div>
                <span>Profit</span>
            </div>
        </div>
    );
});

const Dashboard = ({ allData, updateData, userId, onLogout, modal, setModal, db }) => {
    // --- STATE MANAGEMENT ---
    const [selectedJournalId, setSelectedJournalId] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [visibleTradeCount, setVisibleTradeCount] = useState(TRADES_PER_PAGE);
    const [newTrade, setNewTrade] = useState(() => {
        const today = new Date();
        const todayLocal = new Date(today.getTime() - (today.getTimezoneOffset() * 60000));
        return { date: todayLocal.toISOString().split('T')[0], day: DAY_NAME_MAPPING[today.getDay()], grossPnl: '', taxesAndCharges: '', capitalDeployed: '', notes: '' };
    });
    const [expandedTradeId, setExpandedTradeId] = useState(null);
    const [highlightedDate, setHighlightedDate] = useState(null);

    const currentUserData = useMemo(() => allData || { journals: [], trades: {} }, [allData]);
    const journals = currentUserData.journals || [];
    const trades = useMemo(() => (selectedJournalId ? currentUserData.trades?.[selectedJournalId] : []) || [], [currentUserData, selectedJournalId]);
    const userName = currentUserData?.userInfo?.name;

    // --- SET INITIAL JOURNAL & FORM DEFAULTS ---
    useEffect(() => {
        if (journals.length > 0 && !journals.some(j => j.id === selectedJournalId)) {
            setSelectedJournalId(journals[0].id);
        } else if (journals.length === 0) {
            setSelectedJournalId('');
        }
    }, [journals, selectedJournalId]);

    useEffect(() => {
        const selectedJournal = journals.find(j => j.id === selectedJournalId);
        if (trades && trades.length > 0) {
            const latestCapital = [...trades].sort((a,b) => new Date(b.date) - new Date(a.date))[0].capitalDeployed;
            setNewTrade(prev => ({ ...prev, capitalDeployed: latestCapital || '' }));
        } else if (selectedJournal) {
            setNewTrade(prev => ({ ...prev, capitalDeployed: selectedJournal.initialCapital || '' }));
        }
    }, [trades, journals, selectedJournalId]);

    // --- DERIVED STATE & MEMOIZATION ---
    const selectedJournal = useMemo(() => journals.find(j => j.id === selectedJournalId), [journals, selectedJournalId]);
    const summary = useMemo(() => calculateAnalytics(trades, selectedJournal?.initialCapital), [trades, selectedJournal]);
    const sortedTradesForDisplay = useMemo(() => [...trades].sort((a,b) => new Date(b.date) - new Date(a.date)), [trades]);
    const tickInterval = useMemo(() => Math.max(1, Math.floor((summary.dailyPnlData?.length || 0) / 10)), [summary.dailyPnlData]);

    // --- EVENT HANDLERS ---
    const handleInputChange = (e, setState) => {
        const { name, value } = e.target;
        setState(prev => {
            let updated = { ...prev, [name]: value };
            if (name === 'date' && value) { const date = new Date(value); updated.day = DAY_NAME_MAPPING[date.getUTCDay()]; }
            return updated;
        });
    };

    const handleCreateJournal = (e) => {
        e.preventDefault();
        const form = e.target;
        const name = form.name.value;
        const initialCapital = form.initialCapital.value;
        if (!name || !initialCapital) { setModal({ isOpen: true, type: 'alert', message: 'Please provide a name and initial capital.' }); return; }
        
        const newJournal = { id: generateUniqueId(), name, initialCapital: parseFloat(initialCapital), createdAt: new Date().toISOString() };
        const newData = { ...currentUserData, journals: [...(currentUserData.journals || []), newJournal] };
        updateData(newData);
        setSelectedJournalId(newJournal.id);
        setModal({ isOpen: false });
    };

    const handleAddTrade = (e) => {
        e.preventDefault();
        if (!newTrade.date || newTrade.grossPnl === '' || newTrade.taxesAndCharges === '' || newTrade.capitalDeployed === '') { setModal({ isOpen: true, type: 'alert', message: 'Please fill out all fields.' }); return; }
        
        const tradeToAdd = {
            id: generateUniqueId(), date: newTrade.date, day: newTrade.day,
            grossPnl: parseFloat(newTrade.grossPnl), taxesAndCharges: parseFloat(newTrade.taxesAndCharges),
            capitalDeployed: parseFloat(newTrade.capitalDeployed), notes: newTrade.notes || ""
        };
        const newTradesForJournal = [...(currentUserData.trades?.[selectedJournalId] || []), tradeToAdd];
        const newData = { ...currentUserData, trades: { ...currentUserData.trades, [selectedJournalId]: newTradesForJournal } };
        updateData(newData);

        const today = new Date();
        const todayLocal = new Date(today.getTime() - (today.getTimezoneOffset() * 60000));
        setNewTrade(prev => ({ ...prev, date: todayLocal.toISOString().split('T')[0], day: DAY_NAME_MAPPING[today.getDay()], grossPnl: '', taxesAndCharges: '', notes: '' }));
    };
    
    const handleEditTrade = (tradeToEdit) => {
        setModal({
            isOpen: true,
            type: 'editTrade',
            message: 'Edit Trade',
            onConfirm: handleUpdateTrade,
            defaultValues: tradeToEdit
        });
    };

    const handleUpdateTrade = (e) => {
        e.preventDefault();
        const form = e.target;
        const { defaultValues } = modal;
        const updatedTrade = {
            ...defaultValues,
            date: form.date.value,
            day: DAY_NAME_MAPPING[new Date(form.date.value).getUTCDay()],
            grossPnl: parseFloat(form.grossPnl.value),
            taxesAndCharges: parseFloat(form.taxesAndCharges.value),
            capitalDeployed: parseFloat(form.capitalDeployed.value),
            notes: form.notes.value,
        };

        const newTradesForJournal = (currentUserData.trades[selectedJournalId] || []).map(t =>
            t.id === updatedTrade.id ? updatedTrade : t
        );

        const newData = { ...currentUserData, trades: { ...currentUserData.trades, [selectedJournalId]: newTradesForJournal } };
        updateData(newData);
        setModal({ isOpen: false });
    };

    const handleDeleteTrade = (idToDelete) => {
        setModal({ isOpen: true, type: 'confirm', message: 'Are you sure you want to delete this trade?',
            onConfirm: () => {
                const newTradesForJournal = currentUserData.trades[selectedJournalId].filter(t => t.id !== idToDelete);
                const newData = { ...currentUserData, trades: { ...currentUserData.trades, [selectedJournalId]: newTradesForJournal } };
                updateData(newData);
                setModal({ isOpen: false });
            }
        });
    };

    const handleDeleteAllTrades = () => {
        if (!trades || trades.length === 0) { setModal({ isOpen: true, type: 'alert', message: 'There are no trades to delete.' }); return; }
        setModal({ isOpen: true, type: 'confirm', message: 'Are you sure you want to delete ALL trades in this journal?',
            onConfirm: () => {
                const newData = { ...currentUserData, trades: { ...currentUserData.trades, [selectedJournalId]: [] } };
                updateData(newData);
                setModal({ isOpen: false });
            }
        });
    };

    const handleExportCSV = () => {
        if (!trades || trades.length === 0) { setModal({ isOpen: true, type: 'alert', message: 'No trades to export.' }); return; }
        const headers = ['ID', 'Date', 'Day', 'Gross P&L', 'Taxes & Charges', 'Net P&L', 'Capital Deployed', 'Notes'];
        const csvContent = [ headers.join(','),
          ...sortedTradesForDisplay.map(trade => {
            const netPnl = (trade.grossPnl || 0) - (trade.taxesAndCharges || 0);
            const notes = `"${(trade.notes || '').replace(/"/g, '""')}"`;
            return [trade.id, trade.date, trade.day, trade.grossPnl, trade.taxesAndCharges, netPnl.toFixed(2), trade.capitalDeployed, notes].join(',');
          })
        ].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', `${selectedJournal.name.replace(/\s+/g, '_')}_export.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleLoadSampleData = () => {
        setModal({ isOpen: true, type: 'confirm', message: 'This will add sample trades to this journal. Are you sure?',
            onConfirm: () => {
                const sampleTrades = generateSampleTrades(60, selectedJournal?.initialCapital || 500000);
                const newTradesForJournal = [...(currentUserData.trades?.[selectedJournalId] || []), ...sampleTrades];
                const newData = { ...currentUserData, trades: { ...currentUserData.trades, [selectedJournalId]: newTradesForJournal } };
                updateData(newData);
                setModal({ isOpen: false });
            }
        });
    };
    
    const handleDayClickFromCalendar = (date) => {
        if (!date) return;
        const tradeForDate = sortedTradesForDisplay.find(t => t.date === date);
        if (tradeForDate) {
            setHighlightedDate(date);
            const tradeElement = document.getElementById(`trade-row-${tradeForDate.id}`);
            if (tradeElement) {
                tradeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setExpandedTradeId(tradeForDate.id);
            }
            setTimeout(() => setHighlightedDate(null), 2500);
        }
    };
    
    // --- RENDER ---
    return (
        <div className="container mx-auto max-w-7xl p-4 md:p-6 rounded-2xl shadow-[0_0_60px_-15px_rgba(20,184,166,0.2)] bg-gray-900 border border-teal-800/50 text-gray-100 font-sans">
            <header className="text-center mb-10 relative">
                <h1 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-teal-300 to-cyan-500 tracking-wide">PRO TRADER JOURNAL</h1>
                <p className="text-teal-400/80 mt-2 text-sm md:text-base tracking-widest">{userName ? `Welcome, ${userName}!` : 'ALGO PULSE ASSET MANAGEMENT PRIVATE LIMITED'}</p>
                <button onClick={onLogout} className="absolute top-1/2 -translate-y-1/2 right-0 px-4 py-2 bg-red-600/80 text-white font-bold rounded-lg shadow-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-red-500 transition">Logout</button>
            </header>

            <div className="bg-gray-800/40 p-4 rounded-xl shadow-lg border border-gray-700/70 mb-10 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-3 w-full sm:w-auto">
                    <label htmlFor="journal-select" className="text-lg font-bold text-teal-400">Journal:</label>
                    <select id="journal-select" value={selectedJournalId} onChange={(e) => setSelectedJournalId(e.target.value)} className="p-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition w-full sm:w-64">
                        {journals.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
                    </select>
                </div>
                <button onClick={() => setModal({ isOpen: true, type: 'createJournal', onConfirm: handleCreateJournal, defaultValues: {name: '', initialCapital: ''} })} className="w-full sm:w-auto px-4 py-2 bg-teal-500 text-white font-bold rounded-lg shadow-md hover:bg-teal-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-teal-500 transition"> + New Journal </button>
            </div>
            
            {journals.length === 0 && (
                <div className="text-center p-10 bg-gray-800/30 rounded-lg">
                    <h2 className="text-2xl font-bold text-teal-400">Welcome!</h2>
                    <p className="text-gray-300 mt-2 mb-4">Create your first journal to start tracking your trades.</p>
                    <button onClick={() => setModal({ isOpen: true, type: 'createJournal', onConfirm: handleCreateJournal, defaultValues: {name: '', initialCapital: ''} })} className="px-6 py-3 bg-teal-500 text-white font-bold rounded-lg shadow-md hover:bg-teal-600 transition">+ Create First Journal</button>
                </div>
            )}

            {selectedJournal && (
            <>
                {/* Metric Cards Sections */}
                <div className="mb-10"><h2 className="text-2xl font-bold text-teal-400 mb-4">Account Overview</h2><div className="grid grid-cols-2 md:grid-cols-4 gap-4"><MemoizedMetricCard title="Current Equity" value={formatCurrencyCompact(summary.currentEquity)} colorClass={summary.currentEquity >= summary.startingCapital ? 'text-green-400' : 'text-red-400'} /><MemoizedMetricCard title="Overall P&L" value={formatCurrencyCompact(summary.overallPnl)} colorClass={summary.overallPnl >= 0 ? 'text-green-400' : 'text-red-400'} /><MemoizedMetricCard title="Average Capital" value={formatCurrencyCompact(summary.averageCapital)} /><MemoizedMetricCard title="Return on Investment" value={formatPercentage(summary.roi)} colorClass={summary.roi >= 0 ? 'text-green-400' : 'text-red-400'} /></div></div>
                <div className="mb-10"><h2 className="text-2xl font-bold text-teal-400 mb-4">Performance Metrics</h2><div className="grid grid-cols-2 md:grid-cols-4 gap-4"><MemoizedMetricCard title="Win Rate" value={formatPercentage(summary.winRate)} colorClass="text-green-400" /><MemoizedMetricCard title="Profit Factor" value={(summary.profitFactor || 0).toFixed(2)} colorClass="text-cyan-400" /><MemoizedMetricCard title="Win/Loss Ratio" value={(summary.winLossRatio || 0).toFixed(2)} colorClass="text-cyan-400" /><MemoizedMetricCard title="Expectancy" value={formatCurrencyCompact(summary.expectancy)} colorClass={(summary.expectancy || 0) >= 0 ? 'text-green-400' : 'text-red-400'} /><MemoizedMetricCard title="Avg. Win" value={formatCurrencyCompact(summary.avgProfitOnWinDays)} colorClass="text-green-400" /><MemoizedMetricCard title="Avg. Loss" value={formatCurrencyCompact(summary.avgLossOnLossDays)} colorClass="text-red-400" /><MemoizedMetricCard title="Total Trades" value={summary.totalTrades || 0} /><MemoizedMetricCard title="Winning Trades" value={summary.winDays || 0} colorClass="text-green-400" /></div></div>
                <div className="mb-10"><h2 className="text-2xl font-bold text-teal-400 mb-4">Risk & Extremes</h2><div className="grid grid-cols-2 md:grid-cols-4 gap-4"><MemoizedMetricCard title="Max Drawdown" value={formatPercentage(summary.maxDDPercentage)} colorClass="text-red-400" /><MemoizedMetricCard title="Max Drawdown (Abs)" value={formatCurrencyCompact(summary.maxDrawdown)} colorClass="text-red-400" /><MemoizedMetricCard title="Max Profit" value={formatCurrencyCompact(summary.maxProfit)} colorClass="text-green-400" /><MemoizedMetricCard title="Max Loss" value={formatCurrencyCompact(summary.maxLoss)} colorClass="text-red-400" /><MemoizedMetricCard title="Winning Streak" value={summary.maxWinningStreak || 0} colorClass="text-green-400" /><MemoizedMetricCard title="Losing Streak" value={summary.maxLosingStreak || 0} colorClass="text-red-400" /><MemoizedMetricCard title="Losing Trades" value={summary.lossDays || 0} colorClass="text-red-400" /></div></div>
                
                {/* Charts Section */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
                    <div className="p-5 bg-gray-800/40 rounded-xl shadow-lg border border-gray-700/70 h-96"><h2 className="text-xl font-bold text-teal-400 mb-4">Equity Curve</h2><ResponsiveContainer width="100%" height="85%"><LineChart data={summary.dailyPnlData} margin={{ top: 5, right: 20, left: 25, bottom: 30 }}><CartesianGrid strokeDasharray="3 3" stroke="#4a5568" /><XAxis dataKey="date" stroke="#e5e7eb" fontSize={12} tick={{ fill: '#e5e7eb', angle: -45, textAnchor: 'end' }} interval={tickInterval} tickFormatter={formatDateForAxis} height={50} /><YAxis stroke="#e5e7eb" fontSize={12} tickFormatter={(value) => formatCurrencyCompact(value)} tick={{ fill: '#e5e7eb' }} domain={['auto', 'auto']} /><RechartsTooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }} itemStyle={{ color: '#e5e7eb' }} labelStyle={{ color: '#e5e7eb' }} formatter={(value, name) => [formatCurrencyPrecise(value), name]} /><Legend wrapperStyle={{ fontSize: '14px', color: '#e5e7eb' }} /><Line type="monotone" dataKey="equity" name="Equity" stroke="#2dd4bf" strokeWidth={2} dot={false} activeDot={{ r: 6 }} /></LineChart></ResponsiveContainer></div>
                    <div className="p-5 bg-gray-800/40 rounded-xl shadow-lg border border-gray-700/70 h-96"><h2 className="text-xl font-bold text-teal-400 mb-4">Capital Flow</h2><ResponsiveContainer width="100%" height="85%"><AreaChart data={summary.dailyPnlData} margin={{ top: 5, right: 20, left: 25, bottom: 30 }}><defs><linearGradient id="colorCapital" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#60a5fa" stopOpacity={0.8}/><stop offset="95%" stopColor="#60a5fa" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#4a5568" /><XAxis dataKey="date" stroke="#e5e7eb" fontSize={12} tick={{ fill: '#e5e7eb', angle: -45, textAnchor: 'end' }} interval={tickInterval} tickFormatter={formatDateForAxis} height={50} /><YAxis stroke="#e5e7eb" fontSize={12} tickFormatter={(value) => formatCurrencyCompact(value)} tick={{ fill: '#e5e7eb' }} domain={['auto', 'auto']} /><RechartsTooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }} itemStyle={{ color: '#e5e7eb' }} labelStyle={{ color: '#e5e7eb' }} formatter={(value, name) => [formatCurrencyPrecise(value), name]} /><Legend wrapperStyle={{ fontSize: '14px', color: '#e5e7eb' }} /><Area type="monotone" dataKey="capital" name="Capital" stroke="#60a5fa" fillOpacity={1} fill="url(#colorCapital)" strokeWidth={2} dot={false} activeDot={{ r: 6 }} /></AreaChart></ResponsiveContainer></div>
                    <div className="p-5 bg-gray-800/40 rounded-xl shadow-lg border border-gray-700/70 h-96 lg:col-span-2"><h2 className="text-xl font-bold text-teal-400 mb-4">Daily P&L</h2><ResponsiveContainer width="100%" height="85%"><BarChart data={summary.dailyPnlData} margin={{ top: 5, right: 20, left: 20, bottom: 30 }}><CartesianGrid strokeDasharray="3 3" stroke="#4a5568" /><XAxis dataKey="date" stroke="#e5e7eb" fontSize={12} tick={{ fill: '#e5e7eb', angle: -45, textAnchor: 'end' }} interval={tickInterval} tickFormatter={formatDateForAxis} height={50} /><YAxis stroke="#e5e7eb" fontSize={12} tickFormatter={(value) => formatCurrencyCompact(value)} tick={{ fill: '#e5e7eb' }} /><RechartsTooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }} itemStyle={{ color: '#e5e7eb' }} labelStyle={{ color: '#e5e7eb' }} formatter={(value) => [formatCurrencyPrecise(value), 'Daily P&L']} cursor={{fill: 'rgba(148, 163, 184, 0.1)'}} /><Bar dataKey="pnl" name="Daily P&L">{summary.dailyPnlData?.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#34d399' : '#ef4444'} />)}</Bar></BarChart></ResponsiveContainer></div>
                    <div className="p-5 bg-gray-800/40 rounded-xl shadow-lg border border-gray-700/70 h-96"><h2 className="text-xl font-bold text-teal-400 mb-4">P&L by Day of Week</h2><ResponsiveContainer width="100%" height="85%"><BarChart data={summary.pnlByDayOfWeek} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}><CartesianGrid strokeDasharray="3 3" stroke="#4a5568" /><XAxis dataKey="day" stroke="#e5e7eb" fontSize={12} tick={{ fill: '#e5e7eb' }} /><YAxis stroke="#e5e7eb" fontSize={12} tickFormatter={formatCurrencyCompact} tick={{ fill: '#e5e7eb' }} /><RechartsTooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }} itemStyle={{ color: '#e5e7eb' }} labelStyle={{ color: '#e5e7eb' }} formatter={(value) => [formatCurrencyPrecise(value), 'Total P&L']} cursor={{ fill: 'rgba(148, 163, 184, 0.1)' }} /><Bar dataKey="pnl" name="Total P&L">{summary.pnlByDayOfWeek?.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#2dd4bf' : '#f43f5e'} />)}</Bar></BarChart></ResponsiveContainer></div>
                    <div className="p-5 bg-gray-800/40 rounded-xl shadow-lg border border-gray-700/70 h-96 lg:col-span-2"><h2 className="text-xl font-bold text-teal-400 mb-4">P&L Distribution</h2><ResponsiveContainer width="100%" height="85%"><BarChart data={summary.pnlDistribution} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}><CartesianGrid strokeDasharray="3 3" stroke="#4a5568" /><XAxis dataKey="name" stroke="#e5e7eb" fontSize={10} tick={{ fill: '#e5e7eb' }} /><YAxis allowDecimals={false} stroke="#e5e7eb" fontSize={12} label={{ value: 'No. of Trades', angle: -90, position: 'insideLeft', fill: '#e5e7eb', fontSize: 14 }} tick={{ fill: '#e5e7eb' }} /><RechartsTooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }} itemStyle={{ color: '#e5e7eb' }} labelStyle={{ color: '#e5e7eb' }} formatter={(value) => [value, 'Trades']} cursor={{ fill: 'rgba(148, 163, 184, 0.1)' }} /><Bar dataKey="trades">{summary.pnlDistribution?.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.fill} />)}</Bar></BarChart></ResponsiveContainer></div>
                </div>
                
                {/* Add Trade Form */}
                <div className="bg-gray-800/40 p-6 rounded-xl shadow-lg border border-gray-700/70 mb-10"><h2 className="text-2xl font-bold text-teal-400 mb-4">Add New Trade</h2><form onSubmit={handleAddTrade} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-start"><div className="flex flex-col"><label className="text-sm font-medium text-gray-300 mb-1">Date</label><input type="date" name="date" value={newTrade.date} onChange={(e) => handleInputChange(e, setNewTrade)} className="p-3 bg-gray-900 border border-gray-600 rounded-lg text-white" required/></div><div className="flex flex-col"><label className="text-sm font-medium text-gray-300 mb-1">Gross P&L (₹)</label><input type="number" name="grossPnl" value={newTrade.grossPnl} onChange={(e) => handleInputChange(e, setNewTrade)} className="p-3 bg-gray-900 border border-gray-600 rounded-lg text-white" placeholder="e.g., 5000" step="0.01" required/></div><div className="flex flex-col"><label className="text-sm font-medium text-gray-300 mb-1">Charges (₹)</label><input type="number" name="taxesAndCharges" value={newTrade.taxesAndCharges} onChange={(e) => handleInputChange(e, setNewTrade)} className="p-3 bg-gray-900 border border-gray-600 rounded-lg text-white" placeholder="e.g., 500" step="0.01" required/></div><div className="flex flex-col"><label className="text-sm font-medium text-gray-300 mb-1">Capital (₹)</label><input type="number" name="capitalDeployed" value={newTrade.capitalDeployed} onChange={(e) => handleInputChange(e, setNewTrade)} className="p-3 bg-gray-900 border border-gray-600 rounded-lg text-white" placeholder="Capital for this day" step="1" required/></div><div className="lg:col-span-3 flex flex-col"><label className="text-sm font-medium text-gray-300 mb-1">Notes / Strategy</label><textarea name="notes" value={newTrade.notes} onChange={(e) => handleInputChange(e, setNewTrade)} className="p-3 bg-gray-900 border border-gray-600 rounded-lg w-full text-white" placeholder="e.g., Faded the morning rally..." rows="1"></textarea></div><button type="submit" disabled={isLoading} className="w-full p-3 self-end bg-teal-500 text-white font-bold rounded-lg hover:bg-teal-600 transition disabled:bg-gray-500">{isLoading ? 'Adding...' : 'Add Trade'}</button></form></div>

                {/* Tables Section */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    <div className="bg-gray-800/40 p-5 rounded-xl shadow-lg border border-gray-700/70 overflow-x-auto"><h2 className="text-2xl font-bold text-teal-400 mb-4">Monthly Performance</h2><div className="max-h-96 overflow-y-auto"><table className="min-w-full"><thead className="border-b border-gray-600"><tr className="text-gray-300 text-sm uppercase tracking-wider text-left"><th className="p-3 font-semibold">Month</th><th className="p-3 font-semibold">Net P&L</th><th className="p-3 font-semibold">Avg. Capital</th><th className="p-3 font-semibold">Return</th></tr></thead><tbody>{summary.monthlyPerformance?.length > 0 ? summary.monthlyPerformance.map(m => (<tr key={m.month} className="border-b border-gray-700/50 hover:bg-gray-800/60 transition-colors"><td className="p-3 whitespace-nowrap">{m.month}</td><td className={`p-3 whitespace-nowrap font-semibold ${(m.netPnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatCurrencyCompact(m.netPnl)}</td><td className="p-3 whitespace-nowrap text-gray-300">{formatCurrencyCompact(m.capitalDeployed)}</td><td className={`p-3 whitespace-nowrap font-semibold ${(m.monthlyReturn || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatPercentage(m.monthlyReturn)}</td></tr>)) : (<tr><td colSpan="4" className="p-8 text-center text-gray-400">No monthly data to display.</td></tr>)}</tbody></table></div></div>
                    <div className="bg-gray-800/40 p-5 rounded-xl shadow-lg border border-gray-700/70 overflow-x-auto">
                        <div className="flex flex-wrap justify-between items-center mb-4 gap-4"><h2 className="text-2xl font-bold text-teal-400">Trade History ({trades.length})</h2><div className="flex gap-2"><button onClick={handleLoadSampleData} className="px-4 py-2 bg-indigo-600/80 text-white font-bold rounded-lg hover:bg-indigo-700 transition">Load Sample</button><button onClick={handleDeleteAllTrades} className="px-3 py-2 bg-red-600/80 text-white font-bold rounded-lg hover:bg-red-700 transition" aria-label="Delete All Trades"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clipRule="evenodd" /></svg></button><button onClick={handleExportCSV} className="px-4 py-2 bg-teal-500/80 text-white font-bold rounded-lg hover:bg-teal-600 transition flex items-center gap-2" aria-label="Export to CSV"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /></svg><span className="hidden sm:inline">Export</span></button></div></div>
                        <div className="max-h-96 overflow-y-auto">
                            <table className="min-w-full"><thead className="sticky top-0 bg-gray-800/95 backdrop-blur-sm border-b border-gray-600"><tr className="text-gray-300 text-sm uppercase text-left"><th className="p-3">Date</th><th className="p-3">Net P&L</th><th className="p-3 text-right">Actions</th></tr></thead>
                                <tbody>
                                    {sortedTradesForDisplay.slice(0, visibleTradeCount).map(trade => {
                                        const netPnl = (trade.grossPnl || 0) - (trade.taxesAndCharges || 0);
                                        const isExpanded = expandedTradeId === trade.id;
                                        return (
                                            <React.Fragment key={trade.id}>
                                                <tr id={`trade-row-${trade.id}`} onClick={() => setExpandedTradeId(isExpanded ? null : trade.id)} className={`border-b border-gray-700/50 hover:bg-gray-800/60 cursor-pointer transition-all duration-300 ${highlightedDate === trade.date ? 'bg-teal-500/20' : ''}`}>
                                                    <td className="p-3">{trade.date}</td>
                                                    <td className={`p-3 font-semibold ${netPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatCurrencyPrecise(netPnl)}</td>
                                                    <td className="p-3 text-right space-x-2">
                                                        <button onClick={(e) => { e.stopPropagation(); handleEditTrade(trade); }} className="px-3 py-1 bg-blue-600/20 text-blue-400 hover:bg-blue-500 hover:text-white text-xs font-bold rounded-md transition-colors">EDIT</button>
                                                        <button onClick={(e) => { e.stopPropagation(); handleDeleteTrade(trade.id); }} className="px-3 py-1 bg-red-600/20 text-red-400 hover:bg-red-500 hover:text-white text-xs font-bold rounded-md transition-colors">DELETE</button>
                                                    </td>
                                                </tr>
                                                {isExpanded && (<tr className="bg-gray-800/50"><td colSpan="3" className="p-4"><div className="text-gray-300"><p><strong className="text-teal-400">Gross P&L:</strong> {formatCurrencyPrecise(trade.grossPnl)}</p><p><strong className="text-teal-400">Charges:</strong> {formatCurrencyPrecise(trade.taxesAndCharges)}</p><p><strong className="text-teal-400">Capital:</strong> {formatCurrencyPrecise(trade.capitalDeployed)}</p>{trade.notes && <p className="mt-2"><strong className="text-teal-400">Notes:</strong> {trade.notes}</p>}</div></td></tr>)}
                                            </React.Fragment>
                                        );
                                    })}
                                     {trades.length === 0 && (<tr><td colSpan="3" className="p-8 text-center text-gray-400">No trades recorded yet.</td></tr>)}
                                </tbody>
                            </table>
                        </div>
                         {visibleTradeCount < trades.length && (<div className="mt-4 text-center"><button onClick={() => setVisibleTradeCount(prev => prev + TRADES_PER_PAGE)} className="text-teal-400 hover:text-teal-300 font-semibold">Load More</button></div>)}
                    </div>
                </div>
                 <div className="mb-10"><PerformanceCalendar dailyPnlData={summary.dailyPnlData} onDayClick={handleDayClickFromCalendar} /></div>
            </>
            )}
        </div>
    );
}


// --- MAIN APP COMPONENT ---
const App = () => {
    const [view, setView] = useState('login'); // login, register, plans, dashboard
    const [registrationDetails, setRegistrationDetails] = useState(null);
    const [allData, setAllData] = useState(null);
    const [loggedInCode, setLoggedInCode] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [modal, setModal] = useState({ isOpen: false, type: 'alert', message: '', onConfirm: null, defaultValues: null });
    const [notification, setNotification] = useState({ show: false, message: '' });
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);

    // Initialize Firebase and Auth
    useEffect(() => {
        if (Object.keys(firebaseConfig).length > 0) {
            try {
                const app = initializeApp(firebaseConfig);
                const firestore = getFirestore(app);
                const authInstance = getAuth(app);
                setDb(firestore);
                setAuth(authInstance);

                const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

                if (initialAuthToken) {
                    signInWithCustomToken(authInstance, initialAuthToken).catch(error => { console.error("Custom token sign-in error:", error); signInAnonymously(authInstance); });
                } else {
                    signInAnonymously(authInstance);
                }
            } catch (error) {
                console.error("Firebase initialization error:", error);
                setModal({isOpen: true, type: 'alert', message: 'Could not connect to the database.'});
            }
        } else {
            console.log("Firebase config not available. Skipping initialization.");
            setIsLoading(false);
        }
    }, []);

    // Load Tone.js script
    useEffect(() => {
        const scriptId = 'tone-js-script';
        if (document.getElementById(scriptId)) return; 
        const script = document.createElement('script');
        script.id = scriptId;
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/tone/14.7.77/Tone.js';
        script.async = true;
        document.body.appendChild(script);
        return () => { const existingScript = document.getElementById(scriptId); if (existingScript) document.body.removeChild(existingScript); }
    }, []);

    // Listen for auth state changes and check local storage
    useEffect(() => {
        if (!auth) return;
        const unsubscribe = onAuthStateChanged(auth, user => {
            if (user) {
                const savedCode = localStorage.getItem(SESSION_KEY);
                if (savedCode) {
                    setLoggedInCode(savedCode);
                    setView('dashboard');
                }
            } else {
                setLoggedInCode(null);
                setView('login');
            }
            setIsLoading(false);
        });
        return () => unsubscribe();
    }, [auth]);

    // Data fetching and real-time updates from Firestore
    useEffect(() => {
        if (!db || !loggedInCode) {
            if(!loggedInCode) setAllData({ journals: [], trades: {} }); // Reset data on logout
            return;
        };
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', DB_COLLECTION_NAME, loggedInCode);
        const unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                setAllData(docSnap.data());
            } else {
                setModal({isOpen: true, type: 'alert', message: 'Invalid Access Code.'});
                handleLogout();
            }
             setIsLoading(false);
        }, (error) => {
            console.error("Firestore snapshot error:", error);
            setModal({isOpen: true, type: 'alert', message: 'Error fetching data.'});
            setIsLoading(false);
        });
        return () => unsubscribe();
    }, [db, loggedInCode]);


    const updateData = async (newData) => {
        if (!db || !loggedInCode) return;
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', DB_COLLECTION_NAME, loggedInCode);
        try {
            await setDoc(docRef, newData, { merge: true });
        } catch (error) {
            console.error("Error saving data to Firestore:", error);
            setModal({isOpen: true, type: 'alert', message: 'Could not save data.'});
        }
    };
    
    const handleLogin = async (code) => {
        if (!db) {
            setModal({ isOpen: true, type: 'alert', message: 'Database connection not available. Please refresh and try again.' });
            return;
        }
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', DB_COLLECTION_NAME, code);
        try {
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                localStorage.setItem(SESSION_KEY, code);
                setLoggedInCode(code);
                setView('dashboard');
            } else {
                setModal({ isOpen: true, type: 'alert', message: 'Invalid Access Code.' });
            }
        } catch (error) {
            console.error("Login error:", error);
            setModal({ isOpen: true, type: 'alert', message: 'Could not verify access code. Please try again.' });
        }
    };

    const handleLogout = () => {
        localStorage.removeItem(SESSION_KEY);
        setLoggedInCode(null);
        setView('login');
    };
    
    const showSuccessNotification = (message) => {
        if (window.Tone) { try { const synth = new window.Tone.Synth().toDestination(); synth.triggerAttackRelease("C5", "8n"); } catch (e) { console.error("Could not play sound:", e); } }
        setNotification({ show: true, message });
        setTimeout(() => setNotification({ show: false, message: '' }), 3000);
    };

    const handlePlanActivation = async () => {
        setIsLoading(true);
        const { accessCode } = registrationDetails;
        const initialData = { userInfo: { createdAt: new Date().toISOString() }, journals: [], trades: {} };
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', DB_COLLECTION_NAME, accessCode);
        await setDoc(docRef, initialData);
        await handleLogin(accessCode);
        showSuccessNotification('Plan Activated!');
        setIsLoading(false);
    };

    const handleModalClose = () => setModal({ isOpen: false });
    
    const renderView = () => {
        switch(view) {
            case 'register': return <RegisterScreen setView={setView} setRegistrationDetails={setRegistrationDetails} db={db} setModal={setModal} />;
            case 'plans': return <PlansScreen registrationDetails={registrationDetails} handlePlanActivation={handlePlanActivation} />;
            case 'dashboard': return <Dashboard allData={allData} updateData={updateData} userId={loggedInCode} onLogout={handleLogout} modal={modal} setModal={setModal} db={db} />;
            case 'login': default: return <LoginScreen onLogin={handleLogin} setModal={setModal} setView={setView} db={db} />;
        }
    };

    const Notification = ({ message, show }) => {
        if (!show) return null;
        return (<div className="fixed top-5 right-5 bg-teal-500 text-white py-2 px-4 rounded-lg shadow-lg animate-fade-in-out z-50">{message}</div>);
    };

    const renderModalContent = () => {
        switch (modal.type) {
            case 'createJournal':
                return (<form onSubmit={modal.onConfirm}><h3 className="text-xl font-bold text-teal-400 mb-4">Create New Journal</h3><div className="space-y-4 text-left"><input type="text" name="name" placeholder="Journal Name" defaultValue={modal.defaultValues?.name} className="w-full p-3 bg-gray-900 border border-gray-600 rounded-lg text-white" required /><input type="number" name="initialCapital" placeholder="Initial Capital (₹)" defaultValue={modal.defaultValues?.initialCapital} className="w-full p-3 bg-gray-900 border border-gray-600 rounded-lg text-white" required /></div><div className="flex justify-center gap-4 mt-6"><button type="submit" className="px-6 py-2 bg-teal-500 text-white font-bold rounded-lg hover:bg-teal-600">Create</button><button type="button" onClick={handleModalClose} className="px-6 py-2 bg-gray-600 text-white font-bold rounded-lg hover:bg-gray-700">Cancel</button></div></form>);
            case 'editTrade':
                return (<form onSubmit={modal.onConfirm}><h3 className="text-xl font-bold text-teal-400 mb-4">Edit Trade</h3><div className="space-y-4 text-left"><div className="flex flex-col"><label className="text-sm font-medium text-gray-300 mb-1">Date</label><input type="date" name="date" defaultValue={modal.defaultValues?.date} className="w-full p-3 bg-gray-900 border border-gray-600 rounded-lg text-white" required /></div><div className="flex flex-col"><label className="text-sm font-medium text-gray-300 mb-1">Gross P&L (₹)</label><input type="number" step="0.01" name="grossPnl" defaultValue={modal.defaultValues?.grossPnl} className="w-full p-3 bg-gray-900 border border-gray-600 rounded-lg text-white" required /></div><div className="flex flex-col"><label className="text-sm font-medium text-gray-300 mb-1">Charges (₹)</label><input type="number" step="0.01" name="taxesAndCharges" defaultValue={modal.defaultValues?.taxesAndCharges} className="w-full p-3 bg-gray-900 border border-gray-600 rounded-lg text-white" required /></div><div className="flex flex-col"><label className="text-sm font-medium text-gray-300 mb-1">Capital (₹)</label><input type="number" step="1" name="capitalDeployed" defaultValue={modal.defaultValues?.capitalDeployed} className="w-full p-3 bg-gray-900 border border-gray-600 rounded-lg text-white" required /></div><div className="flex flex-col"><label className="text-sm font-medium text-gray-300 mb-1">Notes</label><textarea name="notes" defaultValue={modal.defaultValues?.notes} className="w-full p-3 bg-gray-900 border border-gray-600 rounded-lg text-white" rows="2"></textarea></div></div><div className="flex justify-center gap-4 mt-6"><button type="submit" className="px-6 py-2 bg-teal-500 text-white font-bold rounded-lg hover:bg-teal-600">Save</button><button type="button" onClick={handleModalClose} className="px-6 py-2 bg-gray-600 text-white font-bold rounded-lg hover:bg-gray-700">Cancel</button></div></form>);
            default: // alert and confirm
                return (<><p className="text-lg text-gray-100 mb-6">{modal.message}</p><div className="flex justify-center gap-4"><button onClick={() => { if(modal.onConfirm) modal.onConfirm(); else handleModalClose(); }} className="px-6 py-2 bg-teal-500 text-white font-bold rounded-lg hover:bg-teal-600">OK</button>{modal.type === 'confirm' && <button onClick={handleModalClose} className="px-6 py-2 bg-gray-600 text-white font-bold rounded-lg hover:bg-gray-700">Cancel</button>}</div></>);
        }
    };

    if (isLoading && !auth) {
        return <div className="min-h-screen bg-gray-950 flex justify-center items-center"><p className="text-teal-400 text-xl">Initializing...</p></div>;
    }

    return (
        <>
            <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'); body { font-family: 'Inter', sans-serif; } .animate-fade-in-out { animation: fadeInOut 3s forwards; } @keyframes fadeInOut { 0% { opacity: 0; transform: translateY(-20px); } 10% { opacity: 1; transform: translateY(0); } 90% { opacity: 1; transform: translateY(0); } 100% { opacity: 0; transform: translateY(-20px); } }`}</style>
            <div className="min-h-screen bg-gray-950">
                <Notification show={notification.show} message={notification.message} />
                {modal.isOpen && (<div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex justify-center items-center z-50 p-4"><div className="bg-gray-800 border border-teal-700 rounded-xl p-6 w-full max-w-md text-center shadow-2xl">{renderModalContent()}</div></div>)}
                {renderView()}
            </div>
        </>
    );
};

export default App;
