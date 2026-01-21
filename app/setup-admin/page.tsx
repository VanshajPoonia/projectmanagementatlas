'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function SetupAdminPage() {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const createAdminUser = async () => {
    setLoading(true)
    setMessage('')

    try {
      const response = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'bobby@goatlasgo.us',
          password: 'Ic3Ic3',
          fullName: 'Bobby Admin',
        }),
      })

      const data = await response.json()

      if (response.ok) {
        setMessage('Admin user created successfully! You can now login at /login')
      } else {
        setMessage(`Error: ${data.error}`)
      }
    } catch (error) {
      setMessage('Failed to create admin user')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Setup Super Admin</CardTitle>
          <CardDescription>
            Create the super admin account for bobby@goatlasgo.us
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={createAdminUser}
            disabled={loading}
            className="w-full"
          >
            {loading ? 'Creating...' : 'Create Admin User'}
          </Button>
          {message && (
            <p className={`text-sm ${message.includes('Error') ? 'text-destructive' : 'text-green-600'}`}>
              {message}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
