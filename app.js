import { View, Text, styles, PixelRatio } from 'react-native';
export default function app(){


    PixelRatio.get();
    return (
        <View style={styles.container}>
            <Text>Hello, World!</Text>
        </View>
    );
}
