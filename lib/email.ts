export async function sendTaskAssignmentEmail(
  recipientEmail: string,
  recipientName: string,
  taskTitle: string,
  taskDescription: string,
  priority: string,
  dueDate: string | null,
  boardTitle: string,
  assignedBy: string
) {
  try {
    const formData = new FormData()
    
    // FormSubmit.co configuration
    formData.append('_subject', `🔔 New Task Assigned: ${taskTitle}`)
    formData.append('_captcha', 'false')
    formData.append('_template', 'box')
    
    // Email content
    formData.append('Recipient', recipientName)
    formData.append('Task', taskTitle)
    formData.append('Description', taskDescription || 'No description provided')
    formData.append('Priority', `${priority} (1-5 scale)`)
    formData.append('Due Date', dueDate ? new Date(dueDate).toLocaleDateString() : 'No due date')
    formData.append('Board', boardTitle)
    formData.append('Assigned By', assignedBy)
    formData.append('Action', '👉 Please log in to view your task details')
    
    const response = await fetch(`https://formsubmit.co/${recipientEmail}`, {
      method: 'POST',
      body: formData,
      headers: {
        'Accept': 'application/json'
      }
    })
    
    if (!response.ok) {
      console.error('[v0] Email notification failed:', await response.text())
    } else {
      console.log('[v0] Email notification sent successfully to:', recipientEmail)
    }
  } catch (error) {
    console.error('[v0] Error sending email notification:', error)
  }
}

export async function sendTaskUpdateEmail(
  recipientEmail: string,
  recipientName: string,
  taskTitle: string,
  updatedBy: string,
  changes: string
) {
  try {
    const formData = new FormData()
    
    formData.append('_subject', `📝 Task Updated: ${taskTitle}`)
    formData.append('_captcha', 'false')
    formData.append('_template', 'box')
    
    formData.append('Recipient', recipientName)
    formData.append('Task', taskTitle)
    formData.append('Updated By', updatedBy)
    formData.append('Changes', changes)
    formData.append('Action', '👉 Log in to view the updated task')
    
    await fetch(`https://formsubmit.co/${recipientEmail}`, {
      method: 'POST',
      body: formData,
      headers: { 'Accept': 'application/json' }
    })
  } catch (error) {
    console.error('[v0] Error sending update email:', error)
  }
}

export async function sendCommentEmail(
  recipientEmail: string,
  recipientName: string,
  taskTitle: string,
  commentAuthor: string,
  commentText: string
) {
  try {
    const formData = new FormData()
    
    formData.append('_subject', `💬 New Comment on: ${taskTitle}`)
    formData.append('_captcha', 'false')
    formData.append('_template', 'box')
    
    formData.append('Recipient', recipientName)
    formData.append('Task', taskTitle)
    formData.append('Comment By', commentAuthor)
    formData.append('Comment', commentText)
    formData.append('Action', '👉 Log in to reply')
    
    await fetch(`https://formsubmit.co/${recipientEmail}`, {
      method: 'POST',
      body: formData,
      headers: { 'Accept': 'application/json' }
    })
  } catch (error) {
    console.error('[v0] Error sending comment email:', error)
  }
}

export async function sendTaskDueSoonEmail(
  recipientEmail: string,
  recipientName: string,
  taskTitle: string,
  dueDate: string,
  daysRemaining: number
) {
  try {
    const formData = new FormData()
    
    formData.append('_subject', `⏰ Task Due Soon: ${taskTitle}`)
    formData.append('_captcha', 'false')
    formData.append('_template', 'box')
    
    formData.append('Recipient', recipientName)
    formData.append('Task', taskTitle)
    formData.append('Due Date', new Date(dueDate).toLocaleDateString())
    formData.append('Days Remaining', `${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}`)
    formData.append('Action', '👉 Complete your task soon!')
    
    await fetch(`https://formsubmit.co/${recipientEmail}`, {
      method: 'POST',
      body: formData,
      headers: { 'Accept': 'application/json' }
    })
  } catch (error) {
    console.error('[v0] Error sending due soon email:', error)
  }
}
