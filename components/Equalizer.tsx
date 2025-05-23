import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { theme } from '../styles/global';

const MusicEqualizer = () => {
  // Références pour les animations
  const bar1Animation = useRef(new Animated.Value(0)).current;
  const bar2Animation = useRef(new Animated.Value(0)).current;
  const bar3Animation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Fonction pour créer une animation en boucle
    const createLoopAnimation = (animatedValue: Animated.Value, duration: number, delay: number = 0) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(animatedValue, {
            toValue: 1,
            duration: duration / 2,
            easing: Easing.ease,
            useNativeDriver: false,
          }),
          Animated.timing(animatedValue, {
            toValue: 0,
            duration: duration / 2,
            easing: Easing.ease,
            useNativeDriver: false,
          }),
        ])
      );
    };

    // Démarrer les animations
    const animations = [
      createLoopAnimation(bar1Animation, 1200, 0),
      createLoopAnimation(bar2Animation, 1200, 200),
      createLoopAnimation(bar3Animation, 1200, 400),
    ];

    Animated.parallel(animations).start();

    // Nettoyage à la destruction du composant
    return () => {
      animations.forEach(anim => anim.stop());
    };
  }, []);

  // Interpolation des hauteurs pour chaque barre
  const bar1Height = bar1Animation.interpolate({
    inputRange: [0, 1],
    outputRange: ['60%', '30%'],
  });

  const bar2Height = bar2Animation.interpolate({
    inputRange: [0, 1],
    outputRange: ['80%', '40%'],
  });

  const bar3Height = bar3Animation.interpolate({
    inputRange: [0, 1],
    outputRange: ['40%', '75%'],
  });

  return (
    <View style={styles.equalizer}>
      <Animated.View style={[styles.bar, styles.bar1, { height: bar1Height }]} />
      <Animated.View style={[styles.bar, styles.bar2, { height: bar2Height }]} />
      <Animated.View style={[styles.bar, styles.bar3, { height: bar3Height }]} />
    </View>
  );
};

const styles = StyleSheet.create({
  equalizer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 30,
    gap: 2,
  },
  bar: {
    backgroundColor: theme.colors.primary,
    width: 4,
    borderRadius: 3,
    marginHorizontal: 1,
  },
  bar1: {
    height: '60%',
  },
  bar2: {
    height: '80%',
  },
  bar3: {
    height: '40%',
  },
});

export default MusicEqualizer;