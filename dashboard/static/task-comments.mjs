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
  // TaskComment stores `created_at` in unix SECONDS (Math.floor(Date.now()/1000)) — Date()
  // needs milliseconds. `user_name` is a server-side join added on top of TaskComment's raw
  // row (which only has user_id) — see handleGetTaskComments/handleAddTaskComment.
  const date = new Date(comment.created_at * 1000).toLocaleString();
  return `
    <div class="comment-item">
      <div class="comment-header">
        <span class="comment-author">${comment.user_name || 'Unknown'}</span>
        <span class="comment-date">${date}</span>
      </div>
      <div class="comment-body">
        ${comment.content}
      </div>
    </div>
  `;
}

// No escapeHtml() here: TaskComment.create()/update() (project/task-comments.mjs) already
// HTML-escape content before storing it, so it is safe to insert as-is. Escaping again here
// would double-escape (e.g. "&amp;" would render as the literal text "&amp;amp;").
