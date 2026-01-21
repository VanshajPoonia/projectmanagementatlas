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
    formData.append('_subject', `New Task Assigned: ${taskTitle}`)
    formData.append('_captcha', 'false')
    formData.append('_template', 'box')
    
    // Email content
    formData.append('recipient_name', recipientName)
    formData.append('task_title', taskTitle)
    formData.append('task_description', taskDescription || 'No description provided')
    formData.append('priority', priority.toUpperCase())
    formData.append('due_date', dueDate ? new Date(dueDate).toLocaleDateString() : 'No due date')
    formData.append('board', boardTitle)
    formData.append('assigned_by', assignedBy)
    
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
