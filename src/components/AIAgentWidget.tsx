import { useState, useRef, useEffect } from 'react';
import { useAIStore } from '../state/useAIStore';
import { agentManager } from '../ai/AgentManager';
import { apiKeyStorage } from '../utils/secureStorage';
import './AIAgentWidget.css';
import { Button } from '../design-system/Button';
import { Input } from '../design-system/Input';
import { 
  Brain, 
  CaretLeft, 
  Key, 
  X, 
  Lightning, 
  Plug, 
  PaperPlaneTilt,
  Lock
} from '@phosphor-icons/react';

// Check if server proxy is available (no env API key means we use proxy)
const USE_SERVER_PROXY = !import.meta.env.VITE_GEMINI_API_KEY;

export function AIAgentWidget() {
  const { isAIActive, isLoading, loadProgress, currentThought, setAIActive } = useAIStore();
  const [isOpen, setIsOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [rememberKey, setRememberKey] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(!USE_SERVER_PROXY); // Hide if using proxy
  const [chatHistory, setChatHistory] = useState<{role: 'user' | 'ai', text: string}[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // On mount, migrate old storage and check for existing key
  useEffect(() => {
    // If using server proxy, no need to check for stored keys
    if (USE_SERVER_PROXY) {
      setShowKeyInput(false);
      return;
    }
    
    // Migrate from old insecure localStorage
    apiKeyStorage.migrate();
    
    // Check if we have a stored key
    const storedKey = apiKeyStorage.get();
    if (storedKey) {
      setApiKey(storedKey);
      setShowKeyInput(false);
    }
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    if (isOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, currentThought, isOpen]);

  const handleSaveKey = () => {
    if (apiKey.trim()) {
      // Store securely - persistent only if user opts in
      apiKeyStorage.set(apiKey.trim(), rememberKey);
      setShowKeyInput(false);
    }
  };

  const handleClearKey = () => {
    apiKeyStorage.remove();
    setApiKey('');
    setShowKeyInput(true);
    setAIActive(false);
  };

  const handleToggleActive = async () => {
    if (!isAIActive) {
      // If using proxy, no API key needed
      if (!USE_SERVER_PROXY && !apiKey) {
        setIsOpen(true);
        setShowKeyInput(true);
        return;
      }
      try {
        // Pass API key only if not using proxy
        await agentManager.init(USE_SERVER_PROXY ? undefined : apiKey);
        setAIActive(true);
      } catch (_error) {
        alert("Failed to connect to AI. Check your API key.");
        setIsOpen(true);
        setShowKeyInput(true);
      }
    } else {
      setAIActive(false);
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim() || isLoading) return;

    const userMessage = inputText;
    setInputText('');
    
    setChatHistory(prev => [...prev, { role: 'user', text: userMessage }]);

    const response = await agentManager.processInput(userMessage);
    
    // Clean response: remove all bracketed commands [COMMAND: value]
    const cleanResponse = response ? response.replace(/\[.*?\]/g, '').trim() : "..."; 
    
    setChatHistory(prev => [...prev, { role: 'ai', text: cleanResponse || "..." }]);
  };

  return (
    <div className={`ai-widget-container ${isOpen ? 'open' : ''}`}>
      {/* Toggle Tab (Visible when closed or open) */}
      <div className="ai-drawer-toggle" onClick={() => setIsOpen(!isOpen)} title="Toggle AI Assistant">
        <span className="ai-drawer-icon">{isOpen ? <CaretLeft size={18} weight="bold" /> : <Brain size={20} weight="duotone" />}</span>
      </div>

      {/* Drawer Content */}
      <div className="ai-widget-content">
        {/* Header */}
        <div className="ai-widget-header">
          <div className="ai-label">
            <Brain size={20} weight="duotone" className="ai-icon" />
            <span>AI Copilot</span>
          </div>
          
          <div className="ai-header-controls">
            <div className={`ai-pulse-dot ${isAIActive ? 'active' : ''} ${isLoading ? 'loading' : ''}`} 
                 title={isLoading ? `Initializing ${loadProgress}%` : isAIActive ? 'Online' : 'Offline'} 
            />
            
            {apiKey && !showKeyInput && (
              <button 
                className="ai-header-btn"
                onClick={handleClearKey}
                title="Clear API Key"
              >
                <Key size={16} weight="duotone" />
              </button>
            )}
            
            <button 
              className={`ai-header-btn ${isAIActive ? 'active' : ''}`}
              onClick={handleToggleActive}
              title={isAIActive ? "Deactivate AI" : "Activate AI"}
            >
              {isAIActive ? <Lightning size={16} weight="fill" /> : <Plug size={16} weight="duotone" />}
            </button>
            
            <button 
              className="ai-header-btn"
              onClick={() => setIsOpen(false)}
              title="Close Drawer"
            >
              <X size={16} weight="bold" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        {showKeyInput && !isAIActive ? (
          <div className="ai-chat-history" style={{ justifyContent: 'center' }}>
            <div className="ai-key-input">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <Key size={20} weight="duotone" color="var(--accent)" />
                <h3 style={{ margin: 0, fontSize: 'var(--text-sm)', fontFamily: 'var(--font-display)', textTransform: 'uppercase' }}>Gemini Access</h3>
              </div>
              <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                Enter your Google Gemini API Key to enable the AI Brain.
              </p>
              <div className="ai-key-row">
                <Input 
                  type="password" 
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  style={{ flex: 1 }}
                />
                <Button onClick={handleSaveKey} size="small">Save</Button>
              </div>
              <label className="ai-remember-key">
                <input 
                  type="checkbox" 
                  checked={rememberKey}
                  onChange={(e) => setRememberKey(e.target.checked)}
                />
                <span>Remember key across sessions</span>
              </label>
              <div className="ai-security-note">
                <Lock size={12} weight="duotone" /> 
                <span>Stored locally, {rememberKey ? 'persists' : 'cleared on close'}</span>
              </div>
              <small style={{ opacity: 0.7 }}>
                Get a free key at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>Google AI Studio</a>
              </small>
            </div>
          </div>
        ) : (
          <>
            <div className="ai-chat-history">
              {chatHistory.length === 0 && (
                <div className="ai-empty-state">
                  <Brain size={48} weight="duotone" className="ai-empty-icon" />
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', marginBottom: '8px', color: 'var(--accent)' }}>
                    Vee Online
                  </div>
                  <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', maxWidth: '200px' }}>
                    I'm Vee, your creative director. Let's set the stage, light the lights, and make some magic!
                  </p>
                </div>
              )}
              
              {chatHistory.map((msg, i) => (
                <div key={i} className={`ai-message ${msg.role}`}>
                  {msg.text}
                </div>
              ))}
              
              {currentThought && (
                <div className="ai-thought">
                  <Lightning size={12} weight="fill" /> 
                  <span>{currentThought}</span>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <form className="ai-input-form" onSubmit={handleSend}>
              <Input 
                type="text" 
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={isAIActive ? "What shall we create?" : "Activate Vee to begin"}
                disabled={!isAIActive || isLoading}
                className="ai-input"
                autoComplete="off"
              />
              <Button 
                type="submit" 
                disabled={!isAIActive || isLoading || !inputText.trim()}
                style={{ width: '44px', height: '44px', borderRadius: 'var(--radius-md)', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <PaperPlaneTilt size={20} weight="fill" />
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

