import * as React from 'react'
import * as SwitchPrimitives from '@radix-ui/react-switch'
import { cn } from '@renderer/lib/utils'

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      'group peer inline-flex h-[22px] w-[40px] shrink-0 cursor-pointer items-center rounded-full',
      'border border-transparent transition-colors duration-motion-fast ease-motion-ease',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      'disabled:cursor-not-allowed disabled:opacity-40',
      'data-[state=checked]:bg-primary data-[state=checked]:shadow-[0_0_0_1px_var(--primary),0_2px_8px_-2px_var(--primary)]',
      'data-[state=unchecked]:bg-input data-[state=unchecked]:shadow-[inset_0_1px_2px_rgba(0,0,0,0.12)]',
      'dark:data-[state=unchecked]:bg-[var(--bg-3)] dark:data-[state=unchecked]:shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)]',
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        'pointer-events-none block h-[18px] w-[18px] rounded-full bg-white',
        /* Dark: light knob on dark track; dark knob on light (primary) track when checked */
        'dark:bg-[var(--text-primary)] group-data-[state=checked]:dark:bg-[hsl(var(--primary-foreground))]',
        'shadow-[0_1px_3px_rgba(0,0,0,0.25),0_0_0_0.5px_rgba(0,0,0,0.04)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.5)]',
        'transition-transform duration-motion-fast ease-motion-ease',
        'data-[state=checked]:translate-x-[20px] data-[state=unchecked]:translate-x-[2px]',
        'active:scale-90 active:duration-75',
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
