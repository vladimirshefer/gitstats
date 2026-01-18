class Progress {

    progress = 0.0;

    /**
     * @param progress - A number between 0.0 and 1.0 representing the progress percentage
     */
    setProgress(progress: number) {
        this.progress = progress;
    }

    getProgress() {
        return this.progress;
    }
}
