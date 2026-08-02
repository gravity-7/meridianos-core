/**
 * Task Comments UI
 * Displays comments for a specific task and allows adding new comments
 */

export function renderTaskComments(taskId, comments = []) {
  return `
    <div class="task-comments-section" data-task-id="${taskId}">
      <div class="section-header">
        <h3>Comments</h3>
      </div>
      
      <div class="comments-list">
        ${comments.length === 0 ? renderEmptyComments() : comments.map(renderComment).join('')}
      </div>
      
      <div class="add-comment-box">
        <form class="add-comment-form">
          <textarea 
            class="comment-input" 
            placeholder="Add a comment..." 
            required
            rows="3"
          ></textarea>
          <div class="comment-actions">
            <button type="submit" class="btn btn-primary btn-sm">Comment</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderEmptyComments() {
  return `
    <div class="empty-state-sm">
      <p>No comments yet.</p>
    </div>
  `;
}

function renderComment(comment) {
  const date = new Date(comment.created_at).toLocaleString();
  return `
    <div class="comment-item">
      <div class="comment-header">
        <span class="comment-author">${comment.username || 'System'}</span>
        <span class="comment-date">${date}</span>
      </div>
      <div class="comment-body">
        ${escapeHtml(comment.content)}
      </div>
    </div>
  `;
}

function escapeHtml(unsafe) {
  return (unsafe || '')
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
