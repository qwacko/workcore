import { mount } from 'svelte';
import App from './ui/App.svelte';
import './ui/style.css';

const root = document.getElementById('app');
if (!root) throw new Error('Missing admin app root');
mount(App, { target: root });
