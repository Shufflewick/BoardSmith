<script setup lang="ts">
import { useAnimationEvents } from '../useAnimationEvents.js';

const props = defineProps<{ resumed: Promise<void>; report: (errors: string[]) => void }>();
const queue = useAnimationEvents()!;
await props.resumed;
const errors: string[] = [];
for (const call of [() => queue.registerHandler('x', async () => {}, { skip: 'drop' }), () => queue.claimNoEvents()]) {
  try {
    call();
  } catch (error) {
    errors.push((error as Error).message);
  }
}
props.report(errors);
</script>

<template><i /></template>
