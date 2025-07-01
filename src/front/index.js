// @ts-check
import './index.css';
import { LOCAL_KEY } from './constants';

/**
 * @template {HTMLElement} T
 * Get an element by ID and ensure it is of a specific type.
 * 
 * @param {string} id The ID of the element to get.
 * @param {new () => T} type The constructor of the expected element type.
 * @returns {T} The element with the specified ID, cast to the expected type.
 */
function strictGetElementById(id, type) {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Element with ID "${id}" not found.`);
    }
    if (!(element instanceof type)) {
        throw new Error(`Element with ID "${id}" is not of type ${type.name}.`);
    }
    return element;
}

// Show last boop count from localStorage instantly
const boopCountInnerEl = strictGetElementById("boop-count-inner", HTMLSpanElement);
const localCount = parseInt(localStorage.getItem(LOCAL_KEY) ?? '', 10);
if (!isNaN(localCount)) {
    boopCountInnerEl.innerText = localCount.toString();
}

// Then load the app rest of the app asynchronously
import('./app').then(() => {
    console.log('App logic loaded successfully');
}).catch((error) => {
    console.error('Error loading app logic:', error);
});

export { strictGetElementById };