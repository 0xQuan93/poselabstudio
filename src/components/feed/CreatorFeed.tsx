import { useState, useEffect } from 'react';
import { useToastStore } from '../../state/useToastStore';
import { useUserStore } from '../../state/useUserStore';
import { Fire, Coin, ArrowClockwise, WarningCircle } from '@phosphor-icons/react';
import { TipCreatorModal } from '../rewards/TipCreatorModal';
import './CreatorFeed.css';

interface FeedItem {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  creatorName: string;
  creatorId: string | null;
  creatorAddress: string | null;
  upvotes: number;
  timestamp: string;
}

export const CreatorFeed = () => {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [upvotedItems, setUpvotedItems] = useState<Set<string>>(new Set());
  const { addToast } = useToastStore();
  const { user, updateCredits } = useUserStore();
  
  // Tipping State
  const [isTipModalOpen, setIsTipModalOpen] = useState(false);
  const [selectedCreator, setSelectedCreator] = useState<{name: string, address: string} | null>(null);

  const fetchFeed = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/.netlify/functions/fetch-feed');
      if (!response.ok) {
        throw new Error('Failed to fetch feed data');
      }
      const data = await response.json();
      setFeed(data.feed);

      // Sync XP based on total upvotes received across all published poses
      if (user) {
        const userPosts = data.feed.filter((item: FeedItem) => item.creatorId === user.id);
        const totalUpvotes = userPosts.reduce((sum: number, item: FeedItem) => sum + item.upvotes, 0);
        // Let's say 1 upvote = 10 XP/Credits
        updateCredits(totalUpvotes * 10);
      }

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred while loading the feed.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFeed();
  }, []);

  const handleUpvote = async (messageId: string) => {
    if (upvotedItems.has(messageId)) return; // Prevent double-clicking

    // Optimistic UI update
    setUpvotedItems((prev) => new Set(prev).add(messageId));
    setFeed((prev) => 
      prev.map((item) => 
        item.id === messageId 
          ? { ...item, upvotes: item.upvotes + 1 }
          : item
      )
    );

    try {
      const response = await fetch('/.netlify/functions/upvote-pose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId })
      });

      if (!response.ok) {
        throw new Error('Failed to record upvote');
      }
    } catch (err) {
      console.error(err);
      // Revert optimistic update on failure
      setUpvotedItems((prev) => {
        const newSet = new Set(prev);
        newSet.delete(messageId);
        return newSet;
      });
      setFeed((prev) => 
        prev.map((item) => 
          item.id === messageId 
            ? { ...item, upvotes: item.upvotes - 1 }
            : item
        )
      );
      addToast('Failed to upvote', 'error');
    }
  };

  const handleOpenTip = (creatorName: string, creatorAddress: string | null) => {
    if (!creatorAddress || creatorAddress === 'Not provided') {
      addToast('This creator has not linked a Solana wallet.', 'warning');
      return;
    }
    setSelectedCreator({ name: creatorName, address: creatorAddress });
    setIsTipModalOpen(true);
  };

  return (
    <div className="studio-feed-container">
      <div className="studio-feed-header">
        <h2>🔥 Studio Feed</h2>
        <button className="icon-button" onClick={fetchFeed} disabled={isLoading} title="Refresh Feed">
          <ArrowClockwise size={18} className={isLoading ? 'spinning' : ''} />
        </button>
      </div>

      <div className="studio-feed-content">
        {isLoading && feed.length === 0 ? (
          <div className="feed-loading">
             <ArrowClockwise size={32} className="spinning" />
             <p>Loading the latest creations...</p>
          </div>
        ) : error ? (
          <div className="feed-error">
             <WarningCircle size={32} color="var(--danger)" />
             <p>{error}</p>
             <button className="secondary" onClick={fetchFeed}>Try Again</button>
          </div>
        ) : feed.length === 0 ? (
          <div className="feed-empty">
            <p>No creations found.</p>
            <p className="small muted">Be the first to publish something from the Export tab!</p>
          </div>
        ) : (
          feed.map((item) => (
            <div key={item.id} className="feed-item">
              {item.imageUrl && (
                <div className="feed-item-image">
                  <img src={item.imageUrl} alt={item.title} loading="lazy" />
                </div>
              )}
              <div className="feed-item-details">
                <div className="feed-item-creator">{item.creatorName}</div>
                {item.description && (
                  <div className="feed-item-desc">{item.description}</div>
                )}
                <div className="feed-item-actions">
                  <button 
                    className={`action-btn ${upvotedItems.has(item.id) ? 'upvoted' : ''}`}
                    onClick={() => handleUpvote(item.id)}
                  >
                    <Fire size={18} weight={upvotedItems.has(item.id) ? "fill" : "duotone"} />
                    {item.upvotes}
                  </button>
                  
                  <button 
                    className="action-btn tip-btn-small"
                    onClick={() => handleOpenTip(item.creatorName, item.creatorAddress)}
                    title={item.creatorAddress ? "Send a Tip" : "No wallet linked"}
                    style={{ opacity: item.creatorAddress ? 1 : 0.5 }}
                  >
                    <Coin size={18} weight="duotone" />
                    Tip
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {selectedCreator && (
        <TipCreatorModal
          isOpen={isTipModalOpen}
          onClose={() => setIsTipModalOpen(false)}
          creatorName={selectedCreator.name}
          creatorAddress={selectedCreator.address}
        />
      )}
    </div>
  );
};