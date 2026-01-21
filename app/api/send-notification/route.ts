import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { to, taskTitle, taskDescription, dueDate } = await request.json()

    // Using FormSubmit.co for email notifications
    const formData = new FormData()
    formData.append('email', to)
    formData.append('_subject', `New Task Assigned: ${taskTitle}`)
    formData.append('_template', 'table')
    formData.append('_captcha', 'false')
    
    const message = `
You have been assigned a new task!

Task: ${taskTitle}
${taskDescription ? `Description: ${taskDescription}` : ''}
${dueDate ? `Due Date: ${new Date(dueDate).toLocaleDateString()}` : ''}

Please log in to your dashboard to view more details.
    `.trim()

    formData.append('message', message)

    // Send email via FormSubmit
    const response = await fetch('https://formsubmit.co/ajax/' + to, {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      throw new Error('Failed to send email')
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error sending notification:', error)
    return NextResponse.json(
      { error: 'Failed to send notification' },
      { status: 500 }
    )
  }
}
