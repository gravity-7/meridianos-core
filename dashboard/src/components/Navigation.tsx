import React from 'react';

interface NavigationProps {
  activeTab: 'dashboard' | 'livestream';
  setActiveTab: (tab: 'dashboard' | 'livestream') => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  setActiveTab,
  theme,
  toggleTheme,
}) => {
  return (
    <header className="nav-container">
      <div className="nav-left">
        <div className="nav-logo">
          <span className="logo-icon">🪐</span>
          <span className="logo-text">MeridianOS <span className="logo-badge">Gateway</span></span>
        </div>
        <nav className="nav-tabs">
          <button
            id="tab-dashboard"
            className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            📊 Analytics Dashboard
          </button>
          <button
            id="tab-livestream"
            className={`tab-btn ${activeTab === 'livestream' ? 'active' : ''}`}
            onClick={() => setActiveTab('livestream')}
          >
            ⚡ Live Stream Logger
          </button>
        </nav>
      </div>
      
      <div className="nav-right">
        <button 
          id="theme-toggle" 
          className="theme-btn" 
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
        </button>
      </div>
    </header>
  );
};
