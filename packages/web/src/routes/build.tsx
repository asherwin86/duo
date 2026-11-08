import { createFileRoute } from '@tanstack/react-router'
import { Workspace } from '../builder/workspace'

// Chat with a model in the browser to make an app, and run it on the phone beside the chat.
export const Route = createFileRoute('/build')({
  head: () => ({
    meta: [
      { title: 'Build · Duo' },
      {
        name: 'description',
        content: 'Describe an app, and a model you connect writes it and runs it on the folding phone beside the chat.'
      }
    ]
  }),
  component: () => <Workspace start="build" />
})
